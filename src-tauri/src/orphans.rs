//! Leftovers of programs that are no longer installed ("orphans"): folders in
//! Program Files, ProgramData and AppData, and vendor keys under
//! HKCU\Software, that no installed program can be linked to.
//!
//! This is deliberately conservative. A folder is only reported when no
//! installed program matches it by name, publisher or install location, no
//! startup entry or service points into it, and nothing in it has changed for
//! 30 days. Everything is reported for review; nothing is selected for
//! deletion automatically, and deletion goes through the Recycle Bin and a
//! registry backup.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use winreg::enums::*;
use winreg::RegKey;

use crate::apps::{list_store_apps, list_win32, AppInfo};
use crate::leftovers::base_name;
use crate::util::{env_path, exe_from_command, expand_env, is_inside, norm, now_secs, open_reg, path_size};

const QUIET_DAYS: u64 = 30;

/// Folder and key names that belong to Windows, drivers or shared runtimes.
const SKIP: &[&str] = &[
    "microsoft", "windows", "windowsapps", "modifiablewindowsapps", "commonfiles",
    "internetexplorer", "windowsdefender", "windowsdefenderadvancedthreatprotection",
    "windowsmail", "windowsmediaplayer", "windowsnt", "windowsphotoviewer", "windowssidebar",
    "windowsportabledevices", "windowssecurity", "windowspowershell", "referenceassemblies",
    "msbuild", "uninstallinformation", "dotnet", "packages", "packagemanagement", "microsoftnet",
    "temp", "tmp", "packagecache", "ssh", "usoshared", "usoprivate", "softwaredistribution",
    "comms", "connecteddevicesplatform", "d3dscache", "crashdumps", "programs", "peerdistrepub",
    "applicationdata", "desktop", "documents", "startmenu", "templates", "favorites", "history",
    "intel", "nvidia", "nvidiacorporation", "amd", "ati", "realtek", "dell", "hp", "hewlettpackard",
    "lenovo", "asus", "msi", "acer", "samsung", "qualcomm", "broadcom", "synaptics", "elantech",
    "classes", "policies", "wow6432node", "clients", "registeredapplications", "appdatalow",
    "odbc", "chromium", "npm", "npmcache", "pip", "nvm", "fontconfig", "sun", "java", "oracle",
    "regid19910810commicrosoft", "virtualstore", "mozillamaintenanceservice", "googleupdater",
    "identities", "keyboardlayout", "printers", "environment", "console", "controlpanel",
    "eudc", "network", "system", "volatileenvironment", "appevents", "software",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    /// "dir" | "regkey"
    kind: &'static str,
    path: String,
    name: String,
    /// "programFiles" | "programData" | "appData" | "localAppData" | "registry"
    root: &'static str,
    size_bytes: u64,
    /// Last change anywhere inside, seconds since the Unix epoch.
    modified: u64,
}

struct Known {
    names: Vec<String>,
    installs: Vec<PathBuf>,
    /// Folders some startup entry or service still runs a program from.
    used: Vec<PathBuf>,
}

fn publisher_names(p: &str) -> Vec<String> {
    const LEGAL: &[&str] = &[
        "inc", "llc", "ltd", "corp", "corporation", "gmbh", "co", "sa", "limited", "ag", "bv",
        "sro", "the", "company", "srl", "pty", "oy", "ab", "as", "software", "technologies",
    ];
    let words: Vec<String> = p
        .split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| !w.is_empty() && !LEGAL.contains(&w.as_str()))
        .collect();
    let mut out = Vec::new();
    if let Some(first) = words.first() {
        out.push(norm(first));
    }
    out.push(norm(&words.join("")));
    out
}

impl Known {
    fn collect() -> Self {
        let mut apps: Vec<AppInfo> = list_win32();
        apps.extend(list_store_apps());
        let mut names = Vec::new();
        let mut installs = Vec::new();
        for a in &apps {
            names.push(norm(&base_name(&a.name)));
            names.push(norm(&a.name));
            if let Some(p) = a.publisher.as_deref() {
                names.extend(publisher_names(p));
            }
            if let Some(loc) = a.install_location.as_deref().filter(|l| !l.trim().is_empty()) {
                installs.push(PathBuf::from(loc.trim().trim_matches('"')));
            }
        }
        names.retain(|n| n.len() >= 3);
        names.sort();
        names.dedup();
        Known { names, installs, used: in_use_folders() }
    }

    /// Something installed can be linked to this name.
    fn matches(&self, name: &str) -> bool {
        let n = norm(name);
        if n.len() < 3 || SKIP.contains(&n.as_str()) {
            return true;
        }
        self.names.iter().any(|k| {
            k == &n || (n.len() >= 4 && k.contains(&n)) || (k.len() >= 4 && n.contains(k.as_str()))
        })
    }

    fn folder_in_use(&self, dir: &Path) -> bool {
        self.installs.iter().chain(self.used.iter()).any(|p| is_inside(p, dir) || is_inside(dir, p))
    }
}

/// Folders of programs started by Run keys and by services.
fn in_use_folders() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for run in [
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
    ] {
        if let Some(k) = open_reg(run, KEY_READ) {
            for (name, _) in k.enum_values().flatten() {
                if let Some(exe) = k.get_value::<String, _>(&name).ok().and_then(|c| exe_from_command(&c)) {
                    if let Some(dir) = exe.parent() {
                        out.push(dir.to_path_buf());
                    }
                }
            }
        }
    }
    if let Some(services) = open_reg(r"HKLM\SYSTEM\CurrentControlSet\Services", KEY_READ) {
        for name in services.enum_keys().flatten() {
            let Ok(k) = services.open_subkey_with_flags(&name, KEY_READ) else { continue };
            if let Some(exe) = k
                .get_value::<String, _>("ImagePath")
                .ok()
                .and_then(|c| exe_from_command(&expand_env(&c)))
            {
                if let Some(dir) = exe.parent() {
                    out.push(dir.to_path_buf());
                }
            }
        }
    }
    out
}

fn secs(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Newest modification time in the first levels of a folder.
fn newest_change(dir: &Path) -> u64 {
    fn walk(dir: &Path, depth: u32, budget: &mut u32, newest: &mut u64) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            if *budget == 0 {
                return;
            }
            *budget -= 1;
            let Ok(md) = e.metadata() else { continue };
            if let Ok(t) = md.modified() {
                *newest = (*newest).max(secs(t));
            }
            if md.is_dir() && depth < 3 && !e.file_type().map(|f| f.is_symlink()).unwrap_or(true) {
                walk(&e.path(), depth + 1, budget, newest);
            }
        }
    }
    let mut newest = std::fs::metadata(dir).and_then(|m| m.modified()).map(secs).unwrap_or(0);
    walk(dir, 0, &mut 5_000, &mut newest);
    newest
}

fn scan_folder_root(root: &Path, label: &'static str, known: &Known, out: &mut Vec<Orphan>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    let quiet_since = now_secs().saturating_sub(QUIET_DAYS * 86_400);
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with('{') || name.to_lowercase().starts_with("regid") {
            continue;
        }
        let path = e.path();
        if known.matches(&name) || known.folder_in_use(&path) {
            continue;
        }
        let modified = newest_change(&path);
        if modified > quiet_since {
            continue;
        }
        let size = path_size(&path);
        if size == 0 {
            continue;
        }
        out.push(Orphan {
            kind: "dir",
            path: path.to_string_lossy().into_owned(),
            name,
            root: label,
            size_bytes: size,
            modified,
        });
    }
}

/// FILETIME (100 ns ticks since 1601) to Unix seconds.
fn filetime_secs(high: u32, low: u32) -> u64 {
    let v = ((high as u64) << 32) | low as u64;
    (v / 10_000_000).saturating_sub(11_644_473_600)
}

fn scan_registry(known: &Known, out: &mut Vec<Orphan>) {
    let Ok(sw) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Software", KEY_READ) else {
        return;
    };
    let quiet_since = now_secs().saturating_sub(QUIET_DAYS * 86_400);
    for name in sw.enum_keys().flatten() {
        if known.matches(&name) {
            continue;
        }
        let Ok(key) = sw.open_subkey_with_flags(&name, KEY_READ) else { continue };
        let Ok(info) = key.query_info() else { continue };
        let ft = &*info.last_write_time;
        let modified = filetime_secs(ft.dwHighDateTime, ft.dwLowDateTime);
        if modified > quiet_since {
            continue;
        }
        // A vendor key whose product sub keys match something installed is in use.
        if key.enum_keys().flatten().any(|sub| known.matches(&sub)) {
            continue;
        }
        out.push(Orphan {
            kind: "regkey",
            path: format!(r"HKCU\Software\{name}"),
            name,
            root: "registry",
            size_bytes: 0,
            modified,
        });
    }
}

#[tauri::command(async)]
pub fn scan_orphans() -> Vec<Orphan> {
    let known = Known::collect();
    let mut out = Vec::new();
    let mut roots: Vec<(PathBuf, &'static str)> = Vec::new();
    for var in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(p) = env_path(var) {
            if !roots.iter().any(|(r, _)| r == &p) {
                roots.push((p, "programFiles"));
            }
        }
    }
    if let Some(p) = env_path("ProgramData") {
        roots.push((p, "programData"));
    }
    if let Some(p) = env_path("APPDATA") {
        roots.push((p, "appData"));
    }
    if let Some(p) = env_path("LOCALAPPDATA") {
        roots.push((p, "localAppData"));
    }
    for (root, label) in &roots {
        scan_folder_root(root, label, &known, &mut out);
    }
    scan_registry(&known, &mut out);
    out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then_with(|| a.name.cmp(&b.name)));
    out
}
