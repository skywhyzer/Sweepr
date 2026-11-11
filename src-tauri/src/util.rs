use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use winreg::enums::*;
use winreg::RegKey;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Lowercase, alphanumeric-only form used for fuzzy name comparison.
pub fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// Make a spawned console program invisible.
pub fn hidden(cmd: &mut Command) -> &mut Command {
    cmd.creation_flags(CREATE_NO_WINDOW)
}

pub fn powershell(script: &str) -> Result<String, String> {
    let full = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; {script}"
    );
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &full,
    ]);
    let out = hidden(&mut cmd).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("powershell exited with {}", out.status)
        } else {
            err
        })
    }
}

/// Split "HKLM\SOFTWARE\Foo" into the hive handle, hive label and sub path.
pub fn split_reg(path: &str) -> Option<(RegKey, &'static str, &str)> {
    let (hive, rest) = path.split_once('\\')?;
    match hive.to_ascii_uppercase().as_str() {
        "HKLM" => Some((RegKey::predef(HKEY_LOCAL_MACHINE), "HKLM", rest)),
        "HKCU" => Some((RegKey::predef(HKEY_CURRENT_USER), "HKCU", rest)),
        _ => None,
    }
}

/// Open a registry key given as "HKLM\..." always through the 64-bit view
/// (32-bit keys are addressed explicitly via WOW6432Node).
pub fn open_reg(path: &str, access: u32) -> Option<RegKey> {
    let (root, _, sub) = split_reg(path)?;
    root.open_subkey_with_flags(sub, access | KEY_WOW64_64KEY).ok()
}

/// Strip quotes and a trailing backslash from a path read from the registry.
pub fn clean_path(raw: &str) -> Option<String> {
    let mut s = raw.trim().trim_matches('"').trim().to_string();
    while s.len() > 3 && (s.ends_with('\\') || s.ends_with('/')) {
        s.pop();
    }
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn lower(p: &Path) -> String {
    p.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// True when `child` equals `parent` or lies inside it (case-insensitive).
pub fn is_inside(child: &Path, parent: &Path) -> bool {
    let c = lower(child);
    let p = lower(parent);
    c == p || c.starts_with(&(p + "\\"))
}

/// Paths that must never be deleted: drive roots, system folders and
/// anything that contains them.
pub fn is_protected_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return true;
    }
    let p = lower(path);
    // Drive root ("c:") or UNC share root.
    if p.len() <= 2 || p.starts_with("\\\\") {
        return true;
    }
    if p.split('\\').any(|part| part == "..") {
        return true;
    }

    let mut critical: Vec<PathBuf> = Vec::new();
    for var in [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "CommonProgramFiles",
        "CommonProgramFiles(x86)",
        "ProgramData",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PUBLIC",
    ] {
        if let Some(v) = env_path(var) {
            critical.push(v);
        }
    }
    if let Some(profile) = env_path("USERPROFILE") {
        for sub in [
            "Desktop",
            "Documents",
            "Downloads",
            "Pictures",
            "Music",
            "Videos",
            "AppData",
            "AppData\\LocalLow",
            "AppData\\Local\\Programs",
            "AppData\\Local\\Packages",
            "AppData\\Local\\Microsoft",
            "AppData\\Roaming\\Microsoft",
        ] {
            critical.push(profile.join(sub));
        }
    }
    if let Some(pd) = env_path("ProgramData") {
        critical.push(pd.join("Microsoft"));
    }

    // Deleting `path` would take a critical folder with it.
    if critical.iter().any(|c| is_inside(c, path)) {
        return true;
    }
    // Nothing inside the Windows directory is ever touched.
    if let Some(win) = env_path("SystemRoot") {
        if is_inside(path, &win) {
            return true;
        }
    }
    false
}

/// Recursive size of a file or folder (does not follow links).
pub fn path_size(path: &Path) -> u64 {
    fn walk(dir: &Path, budget: &mut u32) -> u64 {
        let mut total = 0;
        let Ok(rd) = std::fs::read_dir(dir) else {
            return 0;
        };
        for entry in rd.flatten() {
            if *budget == 0 {
                break;
            }
            *budget -= 1;
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                total += walk(&entry.path(), budget);
            } else if let Ok(md) = entry.metadata() {
                total += md.len();
            }
        }
        total
    }
    match std::fs::symlink_metadata(path) {
        Ok(md) if md.is_dir() => walk(path, &mut 300_000),
        Ok(md) => md.len(),
        Err(_) => 0,
    }
}
