//! Tauri commands of the "Disk" view: drive list, background scan with
//! progress events, queries over the scanned tree and file actions.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
};

use crate::disktree::{ExtStat, Item, MapNode, Progress, Tree, KIND_OTHER};
use crate::util;

#[derive(Default)]
pub struct DiskState {
    tree: Mutex<Option<Tree>>,
    progress: Mutex<Option<Arc<Progress>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    path: String,
    label: String,
    /// "fixed" | "removable" | "network" | "cdrom" | "ram"
    kind: &'static str,
    total: u64,
    free: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    files: u64,
    dirs: u64,
    bytes: u64,
    current: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    root: Item,
    path: String,
    errors: u64,
    cancelled: bool,
    seconds: f64,
    /// Free / total space of the volume, when the scan covers a drive.
    free: Option<u64>,
    total: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    deleted: u32,
    freed: u64,
    failed: Vec<Failure>,
}

#[derive(Serialize)]
pub struct Failure {
    path: String,
    error: String,
}

fn space(root: &str) -> Option<(u64, u64)> {
    let w = util::wide(root);
    let (mut free, mut total) = (0u64, 0u64);
    unsafe {
        GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None).ok()?;
    }
    Some((free, total))
}

#[tauri::command]
pub fn disk_drives() -> Vec<Drive> {
    let mask = unsafe { GetLogicalDrives() };
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let path = format!("{}:\\", (b'A' + i as u8) as char);
        let w = util::wide(&path);
        let kind = match unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) } {
            2 => "removable",
            3 => "fixed",
            4 => "network",
            5 => "cdrom",
            6 => "ram",
            _ => continue,
        };
        // Empty card readers / DVD drives have no space info: skip them.
        let Some((free, total)) = space(&path) else { continue };
        let mut label = [0u16; 261];
        let ok = unsafe {
            GetVolumeInformationW(
                PCWSTR(w.as_ptr()),
                Some(&mut label),
                None,
                None,
                None,
                None,
            )
            .is_ok()
        };
        let label = if ok {
            let n = label.iter().position(|c| *c == 0).unwrap_or(label.len());
            String::from_utf16_lossy(&label[..n])
        } else {
            String::new()
        };
        out.push(Drive {
            path,
            label,
            kind,
            total,
            free,
        });
    }
    out
}

#[tauri::command]
pub async fn disk_scan(
    app: AppHandle,
    state: State<'_, DiskState>,
    path: String,
) -> Result<ScanResult, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    let progress = Arc::new(Progress::default());
    {
        let mut slot = state.progress.lock().unwrap();
        if let Some(old) = slot.as_ref() {
            old.cancel.store(true, Ordering::Relaxed);
        }
        *slot = Some(progress.clone());
    }
    // Free the previous tree before building a new one.
    *state.tree.lock().unwrap() = None;

    let started = std::time::Instant::now();
    let p = progress.clone();
    let scan_root = root.clone();
    let tree = tauri::async_runtime::spawn_blocking(move || {
        let worker = std::thread::Builder::new()
            .name("disk-scan".into())
            .stack_size(16 * 1024 * 1024)
            .spawn({
                let p = p.clone();
                move || Tree::scan(&scan_root, &p)
            })
            .map_err(|e| e.to_string())?;
        while !worker.is_finished() {
            std::thread::sleep(Duration::from_millis(150));
            let current = p.current.lock().map(|c| c.clone()).unwrap_or_default();
            let _ = app.emit(
                "disk-progress",
                ProgressEvent {
                    files: p.files.load(Ordering::Relaxed),
                    dirs: p.dirs.load(Ordering::Relaxed),
                    bytes: p.bytes.load(Ordering::Relaxed),
                    current,
                },
            );
        }
        worker.join().map_err(|_| "scan failed".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let cancelled = progress.cancelled();
    let root_item = tree.item(0).ok_or("empty scan")?;
    let is_drive_root = root.parent().is_none();
    let sp = if is_drive_root { space(&path) } else { None };
    let result = ScanResult {
        root: root_item,
        path: root.to_string_lossy().into_owned(),
        errors: progress.errors.load(Ordering::Relaxed),
        cancelled,
        seconds: started.elapsed().as_secs_f64(),
        free: sp.map(|s| s.0),
        total: sp.map(|s| s.1),
    };
    // Only the latest scan is kept.
    let mut slot = state.progress.lock().unwrap();
    if slot.as_ref().is_some_and(|cur| Arc::ptr_eq(cur, &progress)) {
        *slot = None;
        *state.tree.lock().unwrap() = Some(tree);
        Ok(result)
    } else {
        Err("superseded".into())
    }
}

#[tauri::command]
pub fn disk_cancel(state: State<'_, DiskState>) {
    if let Some(p) = state.progress.lock().unwrap().as_ref() {
        p.cancel.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn disk_close(state: State<'_, DiskState>) {
    if let Some(p) = state.progress.lock().unwrap().take() {
        p.cancel.store(true, Ordering::Relaxed);
    }
    *state.tree.lock().unwrap() = None;
}

fn with_tree<R>(state: &State<'_, DiskState>, f: impl FnOnce(&Tree) -> R) -> Result<R, String> {
    let guard = state.tree.lock().unwrap();
    guard.as_ref().map(f).ok_or_else(|| "no scan".to_string())
}

#[tauri::command]
pub fn disk_item(state: State<'_, DiskState>, id: u32) -> Result<Option<Item>, String> {
    with_tree(&state, |t| t.item(id))
}

#[tauri::command]
pub fn disk_children(state: State<'_, DiskState>, id: u32) -> Result<Vec<Item>, String> {
    with_tree(&state, |t| t.children(id))
}

#[tauri::command]
pub fn disk_ancestry(state: State<'_, DiskState>, id: u32) -> Result<Vec<Item>, String> {
    with_tree(&state, |t| {
        t.ancestry(id).into_iter().filter_map(|i| t.item(i)).collect()
    })
}

#[tauri::command]
pub fn disk_ext_stats(state: State<'_, DiskState>, id: u32) -> Result<Vec<ExtStat>, String> {
    with_tree(&state, |t| t.ext_stats(id))
}

#[tauri::command]
pub fn disk_top_files(
    state: State<'_, DiskState>,
    id: u32,
    count: usize,
) -> Result<Vec<Item>, String> {
    with_tree(&state, |t| t.top_files(id, count.min(1000)))
}

#[tauri::command]
pub fn disk_treemap(
    state: State<'_, DiskState>,
    id: u32,
    depth: u32,
    min_frac: f64,
) -> Result<Option<MapNode>, String> {
    with_tree(&state, |t| t.treemap(id, depth.min(32), min_frac.max(1e-6)))
}

#[tauri::command]
pub fn disk_path(state: State<'_, DiskState>, id: u32) -> Result<Option<String>, String> {
    with_tree(&state, |t| t.path(id).map(|p| p.to_string_lossy().into_owned()))
}

fn path_of(state: &State<'_, DiskState>, id: u32) -> Result<PathBuf, String> {
    with_tree(state, |t| t.path(id))?.ok_or_else(|| "no such item".to_string())
}

/// Open Explorer with the item selected.
#[tauri::command]
pub fn disk_reveal(state: State<'_, DiskState>, id: u32) -> Result<(), String> {
    let p = path_of(&state, id)?;
    let arg = format!("/select,\"{}\"", p.display());
    let mut cmd = Command::new("explorer.exe");
    // raw_arg keeps the quotes exactly as Explorer expects them.
    use std::os::windows::process::CommandExt;
    cmd.raw_arg(arg);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Open a folder in Explorer or a file with its default program.
#[tauri::command]
pub fn disk_open(state: State<'_, DiskState>, id: u32) -> Result<(), String> {
    let p = path_of(&state, id)?;
    Command::new("explorer.exe")
        .arg(&p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn remove_path(p: &Path, permanent: bool) -> Result<(), String> {
    if util::is_protected_path(p) {
        return Err("protected system location".into());
    }
    if permanent {
        let md = std::fs::symlink_metadata(p).map_err(|e| e.to_string())?;
        if md.is_dir() {
            std::fs::remove_dir_all(p)
        } else {
            std::fs::remove_file(p)
        }
        .map_err(|e| e.to_string())
    } else {
        trash::delete(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn disk_delete(
    state: State<'_, DiskState>,
    ids: Vec<u32>,
    permanent: bool,
) -> Result<DeleteResult, String> {
    let mut targets: Vec<(u32, PathBuf, u64)> = Vec::new();
    with_tree(&state, |t| {
        for id in &ids {
            let Some(n) = t.get(*id) else { continue };
            if n.kind == KIND_OTHER {
                continue;
            }
            if let Some(p) = t.path(*id) {
                if p != t.root_path {
                    targets.push((*id, p, n.size));
                }
            }
        }
    })?;

    let mut res = DeleteResult {
        deleted: 0,
        freed: 0,
        failed: Vec::new(),
    };
    for (id, p, size) in targets {
        let p2 = p.clone();
        let r = tauri::async_runtime::spawn_blocking(move || remove_path(&p2, permanent))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
        match r {
            Ok(()) => {
                res.deleted += 1;
                res.freed += size;
                if let Some(t) = state.tree.lock().unwrap().as_mut() {
                    t.remove(id);
                }
            }
            Err(error) => res.failed.push(Failure {
                path: p.to_string_lossy().into_owned(),
                error,
            }),
        }
    }
    Ok(res)
}
