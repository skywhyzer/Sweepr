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

/// True when Sweepr runs elevated.
pub fn is_admin() -> bool {
    unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() }
}

/// Seconds since the Unix epoch.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Text written by a console tool. `sfc` writes UTF-16, newer tools UTF-8 and
/// older ones (DISM, netsh) the OEM code page (866 on Russian Windows).
pub fn decode_console(bytes: &[u8]) -> String {
    let zeros = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    if bytes.len() >= 4 && zeros * 3 > bytes.len() / 2 {
        let wide: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&wide).replace('\0', "");
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    use windows::Win32::Globalization::{GetOEMCP, MultiByteToWideChar, MULTI_BYTE_TO_WIDE_CHAR_FLAGS};
    unsafe {
        let cp = GetOEMCP();
        let flags = MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0);
        let n = MultiByteToWideChar(cp, flags, bytes, None);
        if n <= 0 {
            return String::from_utf8_lossy(bytes).into_owned();
        }
        let mut buf = vec![0u16; n as usize];
        MultiByteToWideChar(cp, flags, bytes, Some(&mut buf));
        String::from_utf16_lossy(&buf)
    }
}

/// Run a console program without a window; returns success and its combined
/// output, decoded. Progress lines redrawn with `\r` keep only their last state.
pub fn run_console(cmd: &mut Command) -> Result<(bool, String), String> {
    let out = hidden(cmd).output().map_err(|e| e.to_string())?;
    let mut text = decode_console(&out.stdout);
    let err = decode_console(&out.stderr);
    if !err.trim().is_empty() {
        text.push('\n');
        text.push_str(&err);
    }
    let cleaned: Vec<String> = text
        .lines()
        .map(|l| l.rsplit('\r').next().unwrap_or("").trim_end().to_string())
        .filter(|l| !l.trim().is_empty())
        .collect();
    Ok((out.status.success(), cleaned.join("\n")))
}

/// Replace `%VAR%` references with their values.
pub fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// The program a command line starts: `"C:\a b\x.exe" -arg` or `C:\x.exe -arg`.
pub fn exe_from_command(cmd: &str) -> Option<PathBuf> {
    let cmd = expand_env(cmd.trim());
    if let Some(rest) = cmd.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(PathBuf::from(&rest[..end]));
    }
    let lower = cmd.to_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".com", ".lnk"] {
        if let Some(i) = lower.find(ext) {
            return Some(PathBuf::from(&cmd[..i + ext.len()]));
        }
    }
    cmd.split_whitespace().next().map(PathBuf::from)
}

/// Company name and description from a file's version resource.
pub fn file_company(path: &Path) -> (Option<String>, Option<String>) {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    let wpath = wide(&path.to_string_lossy());
    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(wpath.as_ptr()), None);
        if size == 0 {
            return (None, None);
        }
        let mut data = vec![0u8; size as usize];
        if GetFileVersionInfoW(PCWSTR(wpath.as_ptr()), None, size, data.as_mut_ptr().cast()).is_err() {
            return (None, None);
        }
        // First language/code page pair from the translation table.
        let mut ptr: *mut core::ffi::c_void = core::ptr::null_mut();
        let mut len = 0u32;
        let trans = wide("\\VarFileInfo\\Translation");
        let langs: Vec<(u16, u16)> =
            if VerQueryValueW(data.as_ptr().cast(), PCWSTR(trans.as_ptr()), &mut ptr, &mut len).as_bool()
                && len >= 4
            {
                let pairs = std::slice::from_raw_parts(ptr as *const u16, (len / 2) as usize);
                pairs.chunks_exact(2).map(|c| (c[0], c[1])).collect()
            } else {
                Vec::new()
            };
        let mut candidates: Vec<String> =
            langs.iter().map(|(l, c)| format!("{l:04x}{c:04x}")).collect();
        candidates.extend(["040904b0".to_string(), "040904e4".to_string(), "041904b0".to_string()]);
        let query = |field: &str| -> Option<String> {
            for c in &candidates {
                let q = wide(&format!("\\StringFileInfo\\{c}\\{field}"));
                let mut p: *mut core::ffi::c_void = core::ptr::null_mut();
                let mut l = 0u32;
                if VerQueryValueW(data.as_ptr().cast(), PCWSTR(q.as_ptr()), &mut p, &mut l).as_bool()
                    && l > 1
                {
                    let s = std::slice::from_raw_parts(p as *const u16, l as usize);
                    let v = String::from_utf16_lossy(s).trim_end_matches('\0').trim().to_string();
                    if !v.is_empty() {
                        return Some(v);
                    }
                }
            }
            None
        };
        (query("CompanyName"), query("FileDescription"))
    }
}
