//! Junk cleaner: a fixed list of well-known places whose contents Windows and
//! programs recreate on their own. Only the contents of these folders are
//! removed, never the folders themselves, links are never followed, and very
//! recent temporary files are left alone because a running installer may still
//! need them.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::util::{env_path, is_admin, is_inside, path_size};

/// What to remove at a location.
enum Mode {
    /// Everything inside the folder older than `min_age`.
    Contents(Duration),
    /// The file itself.
    File,
}

struct Spot {
    path: PathBuf,
    mode: Mode,
}

impl Spot {
    fn contents(path: PathBuf) -> Self {
        Spot { path, mode: Mode::Contents(Duration::ZERO) }
    }
    fn older(path: PathBuf, hours: u64) -> Self {
        Spot { path, mode: Mode::Contents(Duration::from_secs(hours * 3600)) }
    }
    fn file(path: PathBuf) -> Self {
        Spot { path, mode: Mode::File }
    }
    /// Locations under the Windows folder or ProgramData need elevation.
    fn needs_admin(&self) -> bool {
        ["SystemRoot", "ProgramData"]
            .iter()
            .filter_map(|v| env_path(v))
            .any(|root| is_inside(&self.path, &root))
    }
}

fn local(sub: &str) -> Option<PathBuf> {
    env_path("LOCALAPPDATA").map(|p| p.join(sub))
}

fn windir(sub: &str) -> Option<PathBuf> {
    env_path("SystemRoot").map(|p| p.join(sub))
}

/// Browser cache folders for Chromium-based browsers and Firefox, per profile.
fn browser_spots() -> Vec<Spot> {
    let mut out = Vec::new();
    let Some(la) = env_path("LOCALAPPDATA") else { return out };
    for base in [
        r"Google\Chrome\User Data",
        r"Microsoft\Edge\User Data",
        r"BraveSoftware\Brave-Browser\User Data",
        r"Yandex\YandexBrowser\User Data",
        r"Vivaldi\User Data",
    ] {
        let root = la.join(base);
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for profile in rd.flatten() {
            let name = profile.file_name().to_string_lossy().into_owned();
            if name != "Default" && !name.starts_with("Profile ") {
                continue;
            }
            for cache in [r"Cache\Cache_Data", "Code Cache", "GPUCache"] {
                let p = profile.path().join(cache);
                if p.is_dir() {
                    out.push(Spot::contents(p));
                }
            }
        }
    }
    let opera = la.join(r"Opera Software\Opera Stable\Cache");
    if opera.is_dir() {
        out.push(Spot::contents(opera));
    }
    if let Ok(rd) = std::fs::read_dir(la.join(r"Mozilla\Firefox\Profiles")) {
        for profile in rd.flatten() {
            let p = profile.path().join("cache2");
            if p.is_dir() {
                out.push(Spot::contents(p));
            }
        }
    }
    out
}

fn spots(id: &str) -> Vec<Spot> {
    let mut v: Vec<Spot> = Vec::new();
    let mut add = |s: Option<Spot>| {
        if let Some(s) = s {
            v.push(s);
        }
    };
    match id {
        "userTemp" => add(env_path("TEMP").map(|p| Spot::older(p, 24))),
        "systemTemp" => add(windir("Temp").map(|p| Spot::older(p, 24))),
        "updateCache" => add(windir(r"SoftwareDistribution\Download").map(Spot::contents)),
        "deliveryOptimization" => add(
            windir(r"ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache")
                .map(Spot::contents),
        ),
        "crashDumps" => {
            add(local("CrashDumps").map(Spot::contents));
            add(windir("Minidump").map(Spot::contents));
            add(windir("MEMORY.DMP").map(Spot::file));
            add(windir("LiveKernelReports").map(Spot::contents));
        }
        "errorReports" => {
            for sub in [r"Microsoft\Windows\WER\ReportArchive", r"Microsoft\Windows\WER\ReportQueue"] {
                add(local(sub).map(Spot::contents));
                add(env_path("ProgramData").map(|p| Spot::contents(p.join(sub))));
            }
        }
        "shaderCache" => {
            for sub in [
                "D3DSCache",
                r"NVIDIA\DXCache",
                r"NVIDIA\GLCache",
                r"AMD\DxCache",
                r"AMD\DxcCache",
                r"AMD\GLCache",
            ] {
                add(local(sub).map(Spot::contents));
            }
        }
        "browserCache" => return browser_spots(),
        _ => {}
    }
    v
}

const CATEGORIES: &[&str] = &[
    "userTemp",
    "systemTemp",
    "updateCache",
    "deliveryOptimization",
    "crashDumps",
    "errorReports",
    "shaderCache",
    "browserCache",
    "recycleBin",
    "windowsOld",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanCategory {
    id: &'static str,
    size_bytes: u64,
    files: u64,
    /// Every location of this category needs administrator rights.
    needs_admin: bool,
    /// Some locations were skipped because Sweepr is not elevated.
    partial: bool,
    /// Cleaned by Windows itself (Settings opens instead).
    manual: bool,
    paths: Vec<String>,
}

fn old_enough(p: &Path, min_age: Duration) -> bool {
    if min_age.is_zero() {
        return true;
    }
    std::fs::symlink_metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|age| age >= min_age)
        .unwrap_or(false)
}

fn count_files(p: &Path) -> u64 {
    fn walk(dir: &Path, budget: &mut u32) -> u64 {
        let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
        let mut n = 0;
        for e in rd.flatten() {
            if *budget == 0 {
                break;
            }
            *budget -= 1;
            match e.file_type() {
                Ok(ft) if ft.is_dir() && !ft.is_symlink() => n += walk(&e.path(), budget),
                Ok(_) => n += 1,
                Err(_) => {}
            }
        }
        n
    }
    match std::fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => walk(p, &mut 300_000),
        Ok(_) => 1,
        Err(_) => 0,
    }
}

/// Size and file count of what `clean` would remove at a spot.
fn measure(spot: &Spot) -> (u64, u64) {
    match spot.mode {
        Mode::File => match std::fs::metadata(&spot.path) {
            Ok(m) => (m.len(), 1),
            Err(_) => (0, 0),
        },
        Mode::Contents(min_age) => {
            let Ok(rd) = std::fs::read_dir(&spot.path) else { return (0, 0) };
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| old_enough(p, min_age))
                .fold((0, 0), |(s, n), p| (s + path_size(&p), n + count_files(&p)))
        }
    }
}

/// Remove what `measure` counted; anything in use is skipped.
fn clean_spot(spot: &Spot) -> (u64, u64) {
    let (before, _) = measure(spot);
    let mut failed = 0;
    let mut remove = |p: &Path| {
        let Ok(md) = std::fs::symlink_metadata(p) else { return };
        let ft = md.file_type();
        let r = if ft.is_symlink() {
            // A link or junction: remove the link, never what it points to.
            std::fs::remove_dir(p).or_else(|_| std::fs::remove_file(p))
        } else if ft.is_dir() {
            std::fs::remove_dir_all(p)
        } else {
            std::fs::remove_file(p)
        };
        if r.is_err() {
            failed += 1;
        }
    };
    match spot.mode {
        Mode::File => remove(&spot.path),
        Mode::Contents(min_age) => {
            if let Ok(rd) = std::fs::read_dir(&spot.path) {
                for e in rd.flatten() {
                    let p = e.path();
                    if old_enough(&p, min_age) {
                        remove(&p);
                    }
                }
            }
        }
    }
    let (after, _) = measure(spot);
    (before.saturating_sub(after), failed)
}

fn recycle_bin() -> (u64, u64) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    unsafe {
        if SHQueryRecycleBinW(PCWSTR::null(), &mut info).is_ok() {
            (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64)
        } else {
            (0, 0)
        }
    }
}

fn windows_old() -> Option<PathBuf> {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let p = PathBuf::from(format!("{drive}\\Windows.old"));
    p.is_dir().then_some(p)
}

#[tauri::command(async)]
pub fn scan_cleanup() -> Vec<CleanCategory> {
    let admin = is_admin();
    CATEGORIES
        .iter()
        .map(|&id| match id {
            "recycleBin" => {
                let (size, files) = recycle_bin();
                CleanCategory { id, size_bytes: size, files, needs_admin: false, partial: false, manual: false, paths: Vec::new() }
            }
            "windowsOld" => {
                let path = windows_old();
                let size = path.as_deref().map(path_size).unwrap_or(0);
                CleanCategory {
                    id,
                    size_bytes: size,
                    files: 0,
                    needs_admin: false,
                    partial: false,
                    manual: true,
                    paths: path.map(|p| vec![p.to_string_lossy().into_owned()]).unwrap_or_default(),
                }
            }
            _ => {
                let all = spots(id);
                let needs_admin = !all.is_empty() && all.iter().all(Spot::needs_admin);
                let partial = !admin && all.iter().any(Spot::needs_admin);
                let mut size = 0;
                let mut files = 0;
                let mut paths = Vec::new();
                for s in all.iter().filter(|s| admin || !s.needs_admin()) {
                    let (sz, n) = measure(s);
                    size += sz;
                    files += n;
                    if sz > 0 {
                        paths.push(s.path.to_string_lossy().into_owned());
                    }
                }
                CleanCategory { id, size_bytes: size, files, needs_admin, partial, manual: false, paths }
            }
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    id: String,
    freed_bytes: u64,
    /// Items left in place because they are in use or access was denied.
    skipped: u64,
}

#[tauri::command(async)]
pub fn run_cleanup(ids: Vec<String>) -> Vec<CleanResult> {
    let admin = is_admin();
    ids.into_iter()
        .filter(|id| CATEGORIES.contains(&id.as_str()))
        .map(|id| {
            if id == "recycleBin" {
                use windows::core::PCWSTR;
                use windows::Win32::UI::Shell::{
                    SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
                };
                let (before, _) = recycle_bin();
                unsafe {
                    let _ = SHEmptyRecycleBinW(
                        None,
                        PCWSTR::null(),
                        SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
                    );
                }
                let (after, left) = recycle_bin();
                return CleanResult { id, freed_bytes: before.saturating_sub(after), skipped: left };
            }
            let mut freed = 0;
            let mut skipped = 0;
            for s in spots(&id).iter().filter(|s| admin || !s.needs_admin()) {
                let (f, k) = clean_spot(s);
                freed += f;
                skipped += k;
            }
            CleanResult { id, freed_bytes: freed, skipped }
        })
        .collect()
}

/// Windows.old is owned by TrustedInstaller; Windows removes it properly from
/// Settings → System → Storage → Temporary files.
#[tauri::command]
pub fn open_storage_settings() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg("ms-settings:storagesense")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
