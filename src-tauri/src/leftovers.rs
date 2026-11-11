use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::RegKey;

use crate::apps::{list_win32, AppInfo};
use crate::util::{env_path, hidden, is_inside, is_protected_path, norm, open_reg, path_size};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    /// "dir" | "file" | "regkey" | "regvalue"
    pub kind: String,
    pub path: String,
    #[serde(default)]
    pub value_name: Option<String>,
    #[serde(default)]
    pub size_bytes: u64,
    /// "safe" (removed automatically) or "review" (user decides)
    pub confidence: String,
    /// Machine-readable reason, translated in the UI.
    pub reason: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FailedItem {
    pub path: String,
    pub error: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub deleted: u32,
    pub freed_bytes: u64,
    pub failed: Vec<FailedItem>,
    pub backup_path: Option<String>,
    /// Backup id, passed back in so one uninstall keeps a single backup.
    pub session: Option<String>,
    pub deleted_items: Vec<Leftover>,
}

/// A registry backup made during one uninstall.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub created: u64,
    #[serde(default)]
    pub entries: Vec<String>,
}

/// Folder / key names that are shared by the system or by many programs.
const BLOCKED: &[&str] = &[
    "microsoft", "windows", "windowsnt", "windowsapps", "commonfiles", "packages", "temp",
    "tmp", "programs", "system", "system32", "users", "default", "public", "desktop",
    "documents", "downloads", "internetexplorer", "windowsdefender", "microsoftshared",
    "packagecache", "applicationdata", "classes", "policies", "wow6432node", "clients",
    "registeredapplications", "odbc", "uninstall", "apppaths", "run", "currentversion",
    "software", "installer", "cache", "data", "bin", "app", "program", "current", "common",
    "startup", "local", "roaming", "locallow", "drivers", "fonts",
];

fn blocked(n: &str) -> bool {
    BLOCKED.contains(&n)
}

/// Product name without version numbers and architecture tags:
/// "7-Zip 24.08 (x64)" -> "7-Zip".
fn base_name(name: &str) -> String {
    let mut plain = String::new();
    let mut depth = 0;
    for c in name.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => plain.push(c),
            _ => {}
        }
    }
    const NOISE: &[&str] = &["x64", "x86", "64-bit", "32-bit", "64bit", "32bit", "version"];
    plain
        .split_whitespace()
        .filter(|tok| {
            let l = tok.to_lowercase();
            if NOISE.contains(&l.as_str()) || !l.chars().any(|c| c.is_alphanumeric()) {
                return false;
            }
            let v = l.strip_prefix('v').unwrap_or(&l);
            let version_like = v.contains('.')
                && v.chars().any(|c| c.is_ascii_digit())
                && v.chars().all(|c| c.is_ascii_digit() || ".-_".contains(c));
            !version_like
        })
        .collect::<Vec<_>>()
        .join(" ")
}

struct Ctx {
    /// Normalized names a leftover folder/key may have.
    cands: Vec<String>,
    /// Normalized publisher names (parent folders to look into).
    pubs: Vec<String>,
    /// No other installed program shares this product name.
    unique: bool,
    install: Option<PathBuf>,
}

impl Ctx {
    fn new(app: &AppInfo, others: &[AppInfo]) -> Self {
        let base = norm(&base_name(&app.name));
        let mut cands = vec![base.clone()];
        let mut pubs = Vec::new();

        if let Some(publisher) = app.publisher.as_deref() {
            const LEGAL: &[&str] = &[
                "inc", "llc", "ltd", "corp", "corporation", "gmbh", "co", "sa", "limited", "ag",
                "bv", "sro", "the", "company", "srl", "pty", "oy", "ab", "as",
            ];
            let words: Vec<String> = publisher
                .split(|c: char| !c.is_alphanumeric())
                .map(|w| w.to_lowercase())
                .filter(|w| !w.is_empty() && !LEGAL.contains(&w.as_str()))
                .collect();
            pubs.push(words.concat());
            if let Some(first) = words.first() {
                pubs.push(first.clone());
                // "Google Chrome" by Google -> also look for "Chrome".
                if let Some(rest) = base.strip_prefix(first.as_str()) {
                    cands.push(rest.to_string());
                }
            }
        }

        let install = app
            .install_location
            .as_deref()
            .map(PathBuf::from)
            .filter(|p| p.is_absolute());
        if let Some(folder) = install.as_ref().and_then(|p| p.file_name()) {
            cands.push(norm(&folder.to_string_lossy()));
        }

        cands.retain(|c| c.chars().count() >= 3 && !blocked(c));
        cands.sort();
        cands.dedup();
        pubs.retain(|p| p.chars().count() >= 3);
        pubs.sort();
        pubs.dedup();

        let unique = !others.iter().any(|o| {
            let ob = norm(&base_name(&o.name));
            !ob.is_empty() && (ob.starts_with(&base) || base.starts_with(&ob))
        });

        Ctx {
            cands,
            pubs,
            unique,
            install,
        }
    }

    fn exact(&self, n: &str) -> bool {
        self.cands.iter().any(|c| c == n)
    }

    fn fuzzy(&self, n: &str) -> bool {
        n.chars().count() >= 5
            && self
                .cands
                .iter()
                .any(|c| c.chars().count() >= 5 && n.starts_with(c.as_str()))
    }

    /// Exact name matches are safe only when the name is distinctive.
    fn confidence(&self, n: &str) -> &'static str {
        if self.unique && n.chars().count() >= 4 {
            "safe"
        } else {
            "review"
        }
    }
}

fn push_path(out: &mut Vec<Leftover>, path: &Path, confidence: &str, reason: &str) {
    if is_protected_path(path) {
        return;
    }
    let Ok(md) = std::fs::symlink_metadata(path) else {
        return;
    };
    out.push(Leftover {
        kind: if md.is_dir() { "dir" } else { "file" }.into(),
        path: path.to_string_lossy().into_owned(),
        value_name: None,
        size_bytes: path_size(path),
        confidence: confidence.into(),
        reason: reason.into(),
    });
}

fn subdirs(dir: &Path) -> Vec<(PathBuf, String)> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    rd.flatten()
        .filter(|e| {
            e.file_type()
                .map(|t| t.is_dir() && !t.is_symlink())
                .unwrap_or(false)
        })
        .map(|e| (e.path(), norm(&e.file_name().to_string_lossy())))
        .collect()
}

fn scan_data_root(root: &Path, ctx: &Ctx, out: &mut Vec<Leftover>) {
    for (path, n) in subdirs(root) {
        if ctx.exact(&n) {
            push_path(out, &path, ctx.confidence(&n), "nameMatch");
        } else if ctx.pubs.contains(&n) {
            let shared_vendor = blocked(&n);
            for (child, cn) in subdirs(&path) {
                if ctx.exact(&cn) {
                    let conf = if shared_vendor { "review" } else { ctx.confidence(&cn) };
                    push_path(out, &child, conf, "publisherFolder");
                }
            }
        } else if !blocked(&n) && ctx.fuzzy(&n) {
            push_path(out, &path, "review", "similarName");
        }
    }
}

fn scan_shortcuts(dir: &Path, ctx: &Ctx, include_dirs: bool, out: &mut Vec<Leftover>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if include_dirs && ctx.exact(&norm(&entry.file_name().to_string_lossy())) {
                push_path(out, &path, "safe", "shortcut");
            }
        } else if path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("lnk"))
            .unwrap_or(false)
        {
            let stem = norm(&path.file_stem().unwrap_or_default().to_string_lossy());
            if ctx.exact(&stem) {
                push_path(out, &path, "safe", "shortcut");
            }
        }
    }
}

fn push_reg(out: &mut Vec<Leftover>, path: String, value: Option<String>, conf: &str, reason: &str) {
    out.push(Leftover {
        kind: if value.is_some() { "regvalue" } else { "regkey" }.into(),
        path,
        value_name: value,
        size_bytes: 0,
        confidence: conf.into(),
        reason: reason.into(),
    });
}

fn scan_registry_root(root: &str, ctx: &Ctx, out: &mut Vec<Leftover>) {
    let Some(key) = open_reg(root, KEY_READ) else {
        return;
    };
    for sub in key.enum_keys().flatten() {
        let n = norm(&sub);
        if ctx.exact(&n) {
            push_reg(out, format!("{root}\\{sub}"), None, ctx.confidence(&n), "nameMatch");
        } else if ctx.pubs.contains(&n) {
            let shared_vendor = blocked(&n);
            let Ok(vendor) = key.open_subkey_with_flags(&sub, KEY_READ) else {
                continue;
            };
            for child in vendor.enum_keys().flatten() {
                let cn = norm(&child);
                if ctx.exact(&cn) {
                    let conf = if shared_vendor { "review" } else { ctx.confidence(&cn) };
                    push_reg(out, format!("{root}\\{sub}\\{child}"), None, conf, "publisherFolder");
                }
            }
        }
    }
}

const RUN_KEYS: &[&str] = &[
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
    r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
];

const APP_PATHS: &[&str] = &[
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths",
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
    r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths",
];

/// Autostart entries and App Paths pointing into the install folder.
fn scan_install_refs(install: &Path, out: &mut Vec<Leftover>) {
    let needle = install.to_string_lossy().to_lowercase() + "\\";
    if needle.len() < 6 {
        return;
    }
    for run in RUN_KEYS {
        let Some(key) = open_reg(run, KEY_READ) else {
            continue;
        };
        for (name, _) in key.enum_values().flatten() {
            let data: String = key.get_value(&name).unwrap_or_default();
            if data.to_lowercase().contains(&needle) {
                push_reg(out, run.to_string(), Some(name), "safe", "autostart");
            }
        }
    }
    for base in APP_PATHS {
        let Some(key) = open_reg(base, KEY_READ) else {
            continue;
        };
        for sub in key.enum_keys().flatten() {
            let Ok(k) = key.open_subkey_with_flags(&sub, KEY_READ) else {
                continue;
            };
            let target: String = k.get_value("").unwrap_or_default();
            let target = target.trim_matches('"').to_lowercase();
            if target.starts_with(&needle) {
                push_reg(out, format!("{base}\\{sub}"), None, "safe", "appPath");
            }
        }
    }
}

/// Finds files, folders and registry entries a program left behind.
#[tauri::command(async)]
pub fn scan_leftovers(app: AppInfo) -> Vec<Leftover> {
    let mut out = Vec::new();

    if app.kind == "store" {
        if let (Some(local), Some(family)) =
            (env_path("LOCALAPPDATA"), app.package_family_name.as_deref())
        {
            push_path(&mut out, &local.join("Packages").join(family), "safe", "appData");
        }
        return out;
    }

    let others: Vec<AppInfo> = list_win32()
        .into_iter()
        .filter(|o| o.registry_key != app.registry_key || app.registry_key.is_none())
        .collect();
    let ctx = Ctx::new(&app, &others);

    // The install folder itself.
    if let Some(install) = ctx.install.as_deref() {
        let shared = others.iter().any(|o| {
            o.install_location
                .as_deref()
                .map(|loc| is_inside(Path::new(loc), install))
                .unwrap_or(false)
        });
        push_path(&mut out, install, if shared { "review" } else { "safe" }, "installDir");
        scan_install_refs(install, &mut out);
    }

    // The entry in "Programs and Features".
    if let Some(key) = app.registry_key.as_deref() {
        if open_reg(key, KEY_READ).is_some() {
            push_reg(&mut out, key.to_string(), None, "safe", "uninstallEntry");
        }
    }

    if !ctx.cands.is_empty() {
        let mut roots: Vec<PathBuf> = Vec::new();
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramData", "APPDATA", "LOCALAPPDATA"] {
            roots.extend(env_path(var));
        }
        if let Some(local) = env_path("LOCALAPPDATA") {
            roots.push(local.join("Programs"));
        }
        if let Some(profile) = env_path("USERPROFILE") {
            roots.push(profile.join("AppData").join("LocalLow"));
        }
        for root in &roots {
            scan_data_root(root, &ctx, &mut out);
        }

        let start_menu = r"Microsoft\Windows\Start Menu\Programs";
        for var in ["ProgramData", "APPDATA"] {
            if let Some(base) = env_path(var) {
                scan_shortcuts(&base.join(start_menu), &ctx, true, &mut out);
            }
        }
        for var in ["USERPROFILE", "PUBLIC"] {
            if let Some(base) = env_path(var) {
                scan_shortcuts(&base.join("Desktop"), &ctx, false, &mut out);
            }
        }

        for root in [r"HKCU\Software", r"HKLM\SOFTWARE", r"HKLM\SOFTWARE\WOW6432Node"] {
            scan_registry_root(root, &ctx, &mut out);
        }
    }

    // Drop duplicates and anything nested inside another found folder.
    let mut seen = HashSet::new();
    out.retain(|l| seen.insert((l.path.to_lowercase(), l.value_name.clone())));
    let dirs: Vec<(PathBuf, String)> = out
        .iter()
        .filter(|l| l.kind == "dir")
        .map(|l| (PathBuf::from(&l.path), l.confidence.clone()))
        .collect();
    out.retain(|l| {
        if l.kind != "dir" && l.kind != "file" {
            return true;
        }
        let p = Path::new(&l.path);
        !dirs.iter().any(|(d, conf)| {
            d.as_path() != p && is_inside(p, d) && (conf == "safe" || l.confidence == "review")
        })
    });
    out
}

/// Registry keys we refuse to delete no matter what the UI asks for.
fn reg_key_allowed(path: &str) -> bool {
    let parts: Vec<&str> = path.split('\\').filter(|p| !p.is_empty()).collect();
    if parts.len() < 3 || !matches!(parts[0], "HKLM" | "HKCU") {
        return false;
    }
    if !parts[1].eq_ignore_ascii_case("software") {
        return false;
    }
    if parts[2].eq_ignore_ascii_case("WOW6432Node") && parts.len() < 4 {
        return false;
    }
    !blocked(&norm(parts[parts.len() - 1]))
}

fn reg_value_allowed(path: &str) -> bool {
    RUN_KEYS.iter().any(|r| r.eq_ignore_ascii_case(path))
}

fn backups_root() -> Option<PathBuf> {
    Some(env_path("LOCALAPPDATA")?.join("Sweepr").join("backups"))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_digit())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Folder for this uninstall's backup; reuses `session` when it is given.
fn backup_dir(session: Option<&str>) -> Option<PathBuf> {
    let id = match session {
        Some(s) if valid_id(s) => s.to_string(),
        _ => now_secs().to_string(),
    };
    let dir = backups_root()?.join(id);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn reg_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    files.retain(|p| {
        p.extension()
            .map(|e| e.eq_ignore_ascii_case("reg"))
            .unwrap_or(false)
    });
    files.sort();
    files
}

fn read_meta(dir: &Path) -> BackupInfo {
    let mut info: BackupInfo = std::fs::read_to_string(dir.join("meta.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    info.id = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if info.created == 0 {
        info.created = info.id.parse().unwrap_or(0);
    }
    info
}

#[tauri::command(async)]
pub fn list_backups() -> Vec<BackupInfo> {
    let Some(root) = backups_root() else {
        return Vec::new();
    };
    let mut list: Vec<BackupInfo> = std::fs::read_dir(root)
        .map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|p| p.is_dir() && !reg_files(p).is_empty())
        .map(|p| {
            let mut info = read_meta(&p);
            // Backups made before metadata existed: list the files instead.
            if info.entries.is_empty() {
                info.entries = reg_files(&p)
                    .iter()
                    .filter_map(|f| f.file_name().map(|n| n.to_string_lossy().into_owned()))
                    .collect();
            }
            info
        })
        .filter(|b| valid_id(&b.id))
        .collect();
    list.sort_by(|a, b| b.created.cmp(&a.created));
    list
}

/// Imports every .reg file of a backup back into the registry.
#[tauri::command(async)]
pub fn restore_backup(id: String) -> Result<u32, String> {
    if !valid_id(&id) {
        return Err("bad backup id".into());
    }
    let dir = backups_root().ok_or("no backup folder")?.join(&id);
    let files = reg_files(&dir);
    if files.is_empty() {
        return Err("backup is empty".into());
    }
    let mut restored = 0;
    let mut last_error = String::new();
    for file in &files {
        let mut cmd = Command::new("reg.exe");
        cmd.args(["import", &file.to_string_lossy(), "/reg:64"]);
        match hidden(&mut cmd).output() {
            Ok(o) if o.status.success() => restored += 1,
            Ok(o) => last_error = String::from_utf8_lossy(&o.stderr).trim().to_string(),
            Err(e) => last_error = e.to_string(),
        }
    }
    if restored == files.len() as u32 {
        Ok(restored)
    } else {
        Err(format!("{restored}/{}: {last_error}", files.len()))
    }
}

#[tauri::command(async)]
pub fn delete_backup(id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("bad backup id".into());
    }
    let dir = backups_root().ok_or("no backup folder")?.join(&id);
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

fn export_key(key: &str, file: &Path) -> bool {
    let mut cmd = Command::new("reg.exe");
    cmd.args(["export", key, &file.to_string_lossy(), "/y", "/reg:64"]);
    hidden(&mut cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn delete_reg_key(path: &str) -> Result<(), String> {
    let (parent, name) = path.rsplit_once('\\').ok_or("bad key path")?;
    let key = open_reg(parent, KEY_READ | KEY_WRITE).ok_or("cannot open parent key")?;
    key.delete_subkey_all(name).map_err(|e| e.to_string())
}

fn delete_reg_value(path: &str, name: &str) -> Result<(), String> {
    let key: RegKey = open_reg(path, KEY_SET_VALUE).ok_or("cannot open key")?;
    key.delete_value(name).map_err(|e| e.to_string())
}

/// Removes the given leftovers. With `use_trash` files go to the Recycle Bin
/// instead of being erased; with `backup_registry` registry entries are
/// exported to a .reg backup before they are deleted.
#[tauri::command(async)]
pub fn delete_leftovers(
    items: Vec<Leftover>,
    use_trash: bool,
    backup_registry: bool,
    app_name: Option<String>,
    session: Option<String>,
) -> DeleteReport {
    let mut report = DeleteReport::default();
    let mut backup: Option<PathBuf> = None;
    let mut backup_index = 0;
    let mut backed_up_keys: Vec<String> = Vec::new();

    for item in items {
        let result: Result<(), String> = match item.kind.as_str() {
            "dir" | "file" => {
                let path = Path::new(&item.path);
                if is_protected_path(path) {
                    Err("protected path".into())
                } else if std::fs::symlink_metadata(path).is_err() {
                    Ok(()) // already gone
                } else {
                    let is_dir = std::fs::symlink_metadata(path)
                        .map(|m| m.is_dir())
                        .unwrap_or(false);
                    let removed = if use_trash {
                        trash::delete(path).map_err(|e| e.to_string())
                    } else if is_dir {
                        std::fs::remove_dir_all(path).map_err(|e| e.to_string())
                    } else {
                        std::fs::remove_file(path).map_err(|e| e.to_string())
                    };
                    removed.map(|_| {
                        // Remove a vendor folder that became empty.
                        if let Some(parent) = path.parent() {
                            if !is_protected_path(parent) {
                                let _ = std::fs::remove_dir(parent);
                            }
                        }
                    })
                }
            }
            "regkey" | "regvalue" => {
                let is_value = item.kind == "regvalue";
                let allowed = if is_value {
                    reg_value_allowed(&item.path)
                } else {
                    reg_key_allowed(&item.path)
                };
                if !allowed {
                    Err("protected registry key".into())
                } else {
                    if backup_registry && backup.is_none() {
                        backup = backup_dir(session.as_deref());
                        backup_index = backup.as_deref().map(|d| reg_files(d).len()).unwrap_or(0);
                    }
                    let backed_up = !backup_registry
                        || backup
                            .as_ref()
                            .map(|dir| {
                                backup_index += 1;
                                let ok = export_key(
                                    &item.path,
                                    &dir.join(format!("{backup_index:03}.reg")),
                                );
                                if ok {
                                    backed_up_keys.push(match &item.value_name {
                                        Some(v) => format!("{} → {}", item.path, v),
                                        None => item.path.clone(),
                                    });
                                }
                                ok
                            })
                            .unwrap_or(false);
                    if !backed_up {
                        Err("could not create registry backup".into())
                    } else if is_value {
                        delete_reg_value(&item.path, item.value_name.as_deref().unwrap_or(""))
                    } else {
                        delete_reg_key(&item.path)
                    }
                }
            }
            _ => Err("unknown item kind".into()),
        };

        match result {
            Ok(()) => {
                report.deleted += 1;
                report.freed_bytes += item.size_bytes;
                report.deleted_items.push(item.clone());
            }
            Err(error) => report.failed.push(FailedItem {
                path: match &item.value_name {
                    Some(v) => format!("{} → {}", item.path, v),
                    None => item.path.clone(),
                },
                error,
            }),
        }
    }

    if let Some(dir) = &backup {
        if backed_up_keys.is_empty() && reg_files(dir).is_empty() {
            let _ = std::fs::remove_dir(dir);
        } else {
            let mut meta = read_meta(dir);
            if meta.app_name.is_empty() {
                meta.app_name = app_name.unwrap_or_default();
            }
            meta.entries.extend(backed_up_keys);
            if let Ok(json) = serde_json::to_string_pretty(&meta) {
                let _ = std::fs::write(dir.join("meta.json"), json);
            }
            report.session = Some(meta.id);
            report.backup_path = Some(dir.to_string_lossy().into_owned());
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delete_for_test(items: Vec<Leftover>) -> DeleteReport {
        delete_leftovers(items, true, true, Some("self-test".into()), None)
    }

    #[test]
    fn base_names() {
        assert_eq!(base_name("7-Zip 24.08 (x64)"), "7-Zip");
        assert_eq!(base_name("Python 3.12.1 (64-bit)"), "Python");
        assert_eq!(base_name("Visual Studio 2022"), "Visual Studio 2022");
    }

    #[test]
    fn protected_paths() {
        assert!(is_protected_path(Path::new(r"C:\")));
        assert!(is_protected_path(Path::new(r"C:\Windows\System32")));
        assert!(is_protected_path(Path::new(r"C:\Program Files")));
        assert!(is_protected_path(Path::new(r"C:\Users")));
        assert!(!is_protected_path(Path::new(r"C:\Program Files\SomeApp")));
        assert!(!reg_key_allowed(r"HKLM\SOFTWARE\Microsoft"));
        assert!(!reg_key_allowed(r"HKLM\SOFTWARE"));
        assert!(reg_key_allowed(r"HKCU\Software\SomeApp"));
    }

    /// Deletes only dummy data created by the test itself.
    #[test]
    fn delete_dummy() {
        let dir = env_path("LOCALAPPDATA").unwrap().join("SweeprSelfTestDummy");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("a.txt"), b"hello").unwrap();
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(r"Software\SweeprSelfTestDummy\Child")
            .unwrap();
        key.set_value("v", &"1").unwrap();

        let item = |kind: &str, path: String| Leftover {
            kind: kind.into(),
            path,
            value_name: None,
            size_bytes: 5,
            confidence: "safe".into(),
            reason: "nameMatch".into(),
        };
        let report = delete_for_test(vec![
            item("dir", dir.to_string_lossy().into_owned()),
            item("regkey", r"HKCU\Software\SweeprSelfTestDummy".into()),
            item("dir", r"C:\Windows\System32".into()),
            item("regkey", r"HKLM\SOFTWARE\Microsoft".into()),
        ]);
        println!("backup: {:?}", report.backup_path);
        for f in &report.failed {
            println!("refused: {} ({})", f.path, f.error);
        }
        assert_eq!(report.deleted, 2);
        assert_eq!(report.failed.len(), 2);
        assert!(!dir.exists());
        assert!(open_reg(r"HKCU\Software\SweeprSelfTestDummy", KEY_READ).is_none());
        let backup = PathBuf::from(report.backup_path.unwrap());
        assert!(backup.join("001.reg").is_file());
        assert_eq!(report.deleted_items.len(), 2);
        let listed = list_backups();
        let mine = listed.iter().find(|b| Some(&b.id) == report.session.as_ref()).unwrap();
        assert_eq!(mine.app_name, "self-test");
        assert_eq!(mine.entries.len(), 1);
        // Restoring brings the deleted key back.
        assert_eq!(restore_backup(mine.id.clone()), Ok(1));
        assert!(open_reg(r"HKCU\Software\SweeprSelfTestDummy\Child", KEY_READ).is_some());
        delete_reg_key(r"HKCU\Software\SweeprSelfTestDummy").unwrap();
        let _ = std::fs::remove_dir_all(backup);
    }

    /// Read-only: prints what would be found for a few installed programs.
    #[test]
    fn scan_preview() {
        let apps = list_win32();
        for name in ["AiPPT", "Audacity", "Discord", "qBittorrent"] {
            let Some(app) = apps.iter().find(|a| a.name.starts_with(name)) else { continue };
            println!("== {} ({:?})", app.name, app.install_location);
            for l in scan_leftovers(app.clone()) {
                println!("  [{}] {} {} {:?} ({}) {} bytes", l.confidence, l.kind, l.path, l.value_name, l.reason, l.size_bytes);
            }
        }
        println!("store apps: {}", crate::apps::list_store_apps().len());
    }
}
