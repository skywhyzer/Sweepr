//! Startup manager: everything that starts with Windows, in one list.
//!
//! Disabling never deletes anything:
//! * `Run` keys and Startup-folder shortcuts are switched off the way Task
//!   Manager does it, through the `StartupApproved` flags, so Windows and Task
//!   Manager show the same state;
//! * scheduled tasks are disabled with `Disable-ScheduledTask`;
//! * services are moved from automatic to manual start (they still start when
//!   a program asks for them); the original start type is kept in a journal.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::RegValue;

use crate::leftovers::{delete_leftovers, Leftover};
use crate::util::{
    env_path, exe_from_command, expand_env, file_company, is_admin, now_secs, open_reg,
    powershell, run_console, split_reg,
};

const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

/// (registry path of the Run key, StartupApproved sub key, needs admin)
const RUN_SOURCES: &[(&str, &str, bool)] = &[
    (r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", r"HKCU\Run", false),
    (r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", r"HKLM\Run", true),
    (r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", r"HKLM\Run32", true),
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    /// Opaque handle passed back to `set_startup` / `remove_startup`.
    id: String,
    /// "run" | "folder" | "task" | "service"
    source: &'static str,
    name: String,
    command: String,
    path: Option<String>,
    publisher: Option<String>,
    description: Option<String>,
    /// Where the entry lives (registry key, folder, task path, service name).
    location: String,
    enabled: bool,
    needs_admin: bool,
    /// The program it starts is no longer on disk.
    missing: bool,
}

const SEP: char = '\u{1f}';

fn make_id(parts: &[&str]) -> String {
    parts.join(&SEP.to_string())
}

fn split_id(id: &str) -> Vec<String> {
    id.split(SEP).map(str::to_string).collect()
}

/// Fill in path, publisher and the missing flag from a command line.
fn describe(command: &str) -> (Option<String>, Option<String>, Option<String>, bool) {
    let Some(exe) = exe_from_command(command) else {
        return (None, None, None, false);
    };
    let missing = exe.is_absolute() && !exe.exists();
    let (company, desc) = if exe.is_absolute() && !missing {
        file_company(&exe)
    } else {
        (None, None)
    };
    (Some(exe.to_string_lossy().into_owned()), company, desc, missing)
}

// ---------------------------------------------------------------------------
// StartupApproved flags (shared by Run keys and the Startup folders)
// ---------------------------------------------------------------------------

fn approved_key(sub: &str) -> String {
    // "HKCU\Run" -> "HKCU\Software\...\StartupApproved\Run"
    let (hive, leaf) = sub.split_once('\\').unwrap_or(("HKCU", sub));
    let base = if hive == "HKLM" { APPROVED.replace("Software", "SOFTWARE") } else { APPROVED.to_string() };
    format!("{hive}\\{base}\\{leaf}")
}

/// Task Manager writes 12 bytes; an odd first byte means "disabled".
fn approved_enabled(sub: &str, name: &str) -> bool {
    open_reg(&approved_key(sub), KEY_READ)
        .and_then(|k| k.get_raw_value(name).ok())
        .map(|v| v.bytes.first().map(|b| b & 1 == 0).unwrap_or(true))
        .unwrap_or(true)
}

fn set_approved(sub: &str, name: &str, enabled: bool) -> Result<(), String> {
    let path = approved_key(sub);
    let (root, _, rel) = split_reg(&path).ok_or("bad key")?;
    let (key, _) = root
        .create_subkey_with_flags(rel, KEY_WRITE | KEY_WOW64_64KEY)
        .map_err(|e| access(e, &path))?;
    let mut bytes = vec![0u8; 12];
    if enabled {
        bytes[0] = 2;
    } else {
        bytes[0] = 3;
        // FILETIME of the moment it was switched off, as Task Manager stores it.
        let ft = (now_secs() + 11_644_473_600) * 10_000_000;
        bytes[4..12].copy_from_slice(&ft.to_le_bytes());
    }
    key.set_raw_value(name, &RegValue { bytes, vtype: REG_BINARY })
        .map_err(|e| access(e, &path))
}

fn access(e: std::io::Error, path: &str) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        format!("access denied (run as administrator): {path}")
    } else {
        format!("{path}: {e}")
    }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

fn run_items(out: &mut Vec<StartupItem>) {
    for (key_path, sub, admin) in RUN_SOURCES {
        let Some(key) = open_reg(key_path, KEY_READ) else { continue };
        for (name, _) in key.enum_values().flatten() {
            if name.is_empty() {
                continue;
            }
            let Ok(command) = key.get_value::<String, _>(&name) else { continue };
            let (path, publisher, description, missing) = describe(&command);
            out.push(StartupItem {
                id: make_id(&["run", key_path, sub, &name]),
                source: "run",
                name: name.clone(),
                command,
                path,
                publisher,
                description,
                location: key_path.to_string(),
                enabled: approved_enabled(sub, &name),
                needs_admin: *admin,
                missing,
            });
        }
    }
}

#[derive(Deserialize)]
struct Lnk {
    p: String,
    t: Option<String>,
    a: Option<String>,
}

fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Resolve every shortcut in one PowerShell call.
fn resolve_shortcuts(files: &[PathBuf]) -> BTreeMap<String, (String, String)> {
    let lnks: Vec<String> = files
        .iter()
        .filter(|f| f.extension().map(|e| e.eq_ignore_ascii_case("lnk")).unwrap_or(false))
        .map(|f| ps_quote(&f.to_string_lossy()))
        .collect();
    if lnks.is_empty() {
        return BTreeMap::new();
    }
    let script = format!(
        "$s=New-Object -ComObject WScript.Shell; $r=@(@({}) | ForEach-Object {{ $l=$s.CreateShortcut($_); [pscustomobject]@{{p=$_; t=$l.TargetPath; a=$l.Arguments}} }}); ConvertTo-Json -Compress -InputObject $r",
        lnks.join(",")
    );
    powershell(&script)
        .ok()
        .and_then(|json| serde_json::from_str::<Vec<Lnk>>(json.trim()).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|l| (l.p.to_lowercase(), (l.t.unwrap_or_default(), l.a.unwrap_or_default())))
        .collect()
}

fn folder_items(out: &mut Vec<StartupItem>) {
    let mut sources: Vec<(PathBuf, &str, bool)> = Vec::new();
    if let Some(appdata) = env_path("APPDATA") {
        sources.push((appdata.join(r"Microsoft\Windows\Start Menu\Programs\Startup"), r"HKCU\StartupFolder", false));
    }
    if let Some(pd) = env_path("ProgramData") {
        sources.push((pd.join(r"Microsoft\Windows\Start Menu\Programs\StartUp"), r"HKLM\StartupFolder", true));
    }
    for (dir, sub, admin) in sources {
        let files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect())
            .unwrap_or_default();
        let files: Vec<PathBuf> = files
            .into_iter()
            .filter(|p| {
                !p.file_name()
                    .map(|n| n.to_string_lossy().eq_ignore_ascii_case("desktop.ini"))
                    .unwrap_or(true)
            })
            .collect();
        let targets = resolve_shortcuts(&files);
        for file in files {
            let file_name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let display = file.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let (target, args) = targets
                .get(&file.to_string_lossy().to_lowercase())
                .cloned()
                .unwrap_or_else(|| (file.to_string_lossy().into_owned(), String::new()));
            let command = if args.is_empty() {
                format!("\"{target}\"")
            } else {
                format!("\"{target}\" {args}")
            };
            let (path, publisher, description, missing) = if target.is_empty() {
                (None, None, None, false)
            } else {
                describe(&command)
            };
            out.push(StartupItem {
                id: make_id(&["folder", &file.to_string_lossy(), sub, &file_name]),
                source: "folder",
                name: display,
                command,
                path,
                publisher,
                description,
                location: dir.to_string_lossy().into_owned(),
                enabled: approved_enabled(sub, &file_name),
                needs_admin: admin,
                missing,
            });
        }
    }
}

#[derive(Deserialize)]
struct Task {
    n: String,
    p: String,
    s: String,
    e: Option<String>,
    g: Option<String>,
    d: Option<String>,
}

fn task_items(out: &mut Vec<StartupItem>) {
    // Third-party tasks that run at sign-in or at boot.
    let script = r#"$r=@(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' -and @($_.Triggers | Where-Object { $_.CimClass.CimClassName -in 'MSFT_TaskLogonTrigger','MSFT_TaskBootTrigger' }).Count -gt 0 } | ForEach-Object { $a=$_.Actions | Select-Object -First 1; [pscustomobject]@{n=$_.TaskName; p=$_.TaskPath; s=[string]$_.State; e=[string]$a.Execute; g=[string]$a.Arguments; d=[string]$_.Description} }); ConvertTo-Json -Compress -InputObject $r"#;
    let Ok(json) = powershell(script) else { return };
    let tasks: Vec<Task> = serde_json::from_str(json.trim()).unwrap_or_default();
    for t in tasks {
        let exe = t.e.clone().unwrap_or_default();
        let command = match t.g.as_deref() {
            Some(a) if !a.is_empty() => format!("\"{exe}\" {a}"),
            _ => format!("\"{exe}\""),
        };
        let (path, publisher, description, missing) = if exe.is_empty() {
            (None, None, None, false)
        } else {
            describe(&command)
        };
        out.push(StartupItem {
            id: make_id(&["task", &t.p, &t.n]),
            source: "task",
            name: t.n.clone(),
            command,
            path,
            publisher,
            description: description.or(t.d.filter(|d| !d.is_empty())),
            location: format!("{}{}", t.p, t.n),
            enabled: !t.s.eq_ignore_ascii_case("Disabled"),
            needs_admin: false,
            missing,
        });
    }
}

// ---- services --------------------------------------------------------------

fn journal_path() -> Option<PathBuf> {
    Some(env_path("LOCALAPPDATA")?.join("Sweepr").join("startup.json"))
}

/// Services Sweepr moved to manual start, with their original start mode.
fn load_journal() -> BTreeMap<String, String> {
    journal_path()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_journal(j: &BTreeMap<String, String>) -> Result<(), String> {
    let path = journal_path().ok_or("LOCALAPPDATA is not set")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(j).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn service_items(out: &mut Vec<StartupItem>) {
    let journal = load_journal();
    let Some(services) = open_reg(r"HKLM\SYSTEM\CurrentControlSet\Services", KEY_READ) else { return };
    let windir = env_path("SystemRoot").map(|p| p.to_string_lossy().to_lowercase());
    for name in services.enum_keys().flatten() {
        let Ok(key) = services.open_subkey_with_flags(&name, KEY_READ) else { continue };
        let ty: u32 = key.get_value("Type").unwrap_or(0);
        if ty & 0x30 == 0 {
            continue; // a driver, not a Win32 service
        }
        let start: u32 = key.get_value("Start").unwrap_or(4);
        let ours = journal.contains_key(&name);
        if start != 2 && !(start == 3 && ours) {
            continue;
        }
        let Ok(image) = key.get_value::<String, _>("ImagePath") else { continue };
        let expanded = expand_env(&image);
        let lower = expanded.to_lowercase();
        // Windows' own services live in the Windows folder (svchost and co).
        if windir.as_deref().map(|w| lower.contains(w)).unwrap_or(false)
            || lower.starts_with("system32\\")
            || lower.starts_with("\\systemroot\\")
        {
            continue;
        }
        let display: String = key
            .get_value::<String, _>("DisplayName")
            .ok()
            .filter(|d| !d.starts_with('@'))
            .unwrap_or_else(|| name.clone());
        let (path, publisher, description, missing) = describe(&expanded);
        if publisher.as_deref().map(|p| p.starts_with("Microsoft")).unwrap_or(false) {
            continue;
        }
        out.push(StartupItem {
            id: make_id(&["service", &name]),
            source: "service",
            name: display,
            command: expanded,
            path,
            publisher,
            description: description
                .or_else(|| key.get_value::<String, _>("Description").ok().filter(|d| !d.starts_with('@'))),
            location: name.clone(),
            enabled: start == 2,
            needs_admin: true,
            missing,
        });
    }
}

fn sc_config(name: &str, mode: &str) -> Result<(), String> {
    let mut cmd = Command::new("sc.exe");
    cmd.args(["config", name, "start=", mode]);
    let (ok, text) = run_console(&mut cmd)?;
    if ok {
        Ok(())
    } else {
        Err(text)
    }
}

fn set_service(name: &str, enabled: bool) -> Result<(), String> {
    if !is_admin() {
        return Err("administrator rights are required".into());
    }
    let mut journal = load_journal();
    if enabled {
        let mode = journal.get(name).cloned().unwrap_or_else(|| "auto".into());
        sc_config(name, &mode)?;
        journal.remove(name);
    } else {
        let delayed = open_reg(&format!(r"HKLM\SYSTEM\CurrentControlSet\Services\{name}"), KEY_READ)
            .and_then(|k| k.get_value::<u32, _>("DelayedAutostart").ok())
            .unwrap_or(0)
            == 1;
        journal
            .entry(name.to_string())
            .or_insert_with(|| if delayed { "delayed-auto".into() } else { "auto".into() });
        save_journal(&journal)?;
        sc_config(name, "demand")?;
        return Ok(());
    }
    save_journal(&journal)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn list_startup() -> Vec<StartupItem> {
    let mut out = Vec::new();
    run_items(&mut out);
    folder_items(&mut out);
    task_items(&mut out);
    service_items(&mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command(async)]
pub fn set_startup(id: String, enabled: bool) -> Result<(), String> {
    let p = split_id(&id);
    match p.first().map(String::as_str) {
        Some("run") if p.len() == 4 => set_approved(&p[2], &p[3], enabled),
        Some("folder") if p.len() == 4 => set_approved(&p[2], &p[3], enabled),
        Some("task") if p.len() == 3 => {
            let verb = if enabled { "Enable-ScheduledTask" } else { "Disable-ScheduledTask" };
            powershell(&format!(
                "{verb} -TaskPath {} -TaskName {} | Out-Null",
                ps_quote(&p[1]),
                ps_quote(&p[2])
            ))
            .map(|_| ())
        }
        Some("service") if p.len() == 2 => set_service(&p[1], enabled),
        _ => Err("bad startup id".into()),
    }
}

/// Remove an entry whose program is gone. The registry value is backed up
/// first and a shortcut goes to the Recycle Bin, so this can be undone too.
#[tauri::command(async)]
pub fn remove_startup(id: String, name: String) -> Result<(), String> {
    let p = split_id(&id);
    let item = match p.first().map(String::as_str) {
        Some("run") if p.len() == 4 => Leftover {
            kind: "regvalue".into(),
            path: p[1].clone(),
            value_name: Some(p[3].clone()),
            size_bytes: 0,
            confidence: "safe".into(),
            reason: "autostart".into(),
        },
        Some("folder") if p.len() == 4 => Leftover {
            kind: "file".into(),
            path: p[1].clone(),
            value_name: None,
            size_bytes: 0,
            confidence: "safe".into(),
            reason: "shortcut".into(),
        },
        _ => return Err("only broken Run entries and shortcuts can be removed".into()),
    };
    let report = delete_leftovers(vec![item], true, true, Some(format!("{name} (startup)")), None);
    match report.failed.into_iter().next() {
        Some(f) => Err(f.error),
        None => Ok(()),
    }
}
