//! System Restore points: list them, create one (Sweepr does this on its own
//! before uninstalling a program or applying a high-risk tweak), delete them,
//! switch System Protection on, and open Windows' own restore wizard.

use serde::{Deserialize, Serialize};
use windows::Win32::System::Restore::SRRemoveRestorePoint;
use winreg::enums::*;

use crate::util::{is_admin, open_reg, powershell, split_reg};

const SR_KEY: &str = r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePoint {
    sequence: u32,
    description: String,
    /// Seconds since the Unix epoch.
    created: i64,
    /// Windows' RestorePointType: 0 install, 1 uninstall, 10 driver, 12 settings…
    kind: i32,
}

/// One row of the PowerShell output.
#[derive(Deserialize)]
struct Raw {
    s: u32,
    d: String,
    t: i64,
    #[serde(default)]
    y: i32,
}

/// Disk space taken by restore points (shadow storage of the system drive).
#[derive(Deserialize)]
struct RawSpace {
    u: Option<f64>,
    m: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStatus {
    /// System Protection is on for at least one drive.
    enabled: bool,
    points: Vec<RestorePoint>,
    /// Bytes used by restore points, if Windows reports it.
    used_bytes: Option<u64>,
    /// Upper limit set for them; `None` when unlimited.
    max_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveFailure {
    sequence: u32,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResult {
    deleted: Vec<u32>,
    failed: Vec<RemoveFailure>,
}

fn protection_enabled() -> bool {
    open_reg(SR_KEY, KEY_READ)
        .and_then(|k| k.get_value::<u32, _>("RPSessionInterval").ok())
        .map(|v| v != 0)
        .unwrap_or(false)
}

/// Windows reports "unlimited" as a value near u64::MAX; treat anything above
/// 1 PB as no limit.
fn bytes(v: Option<f64>) -> Option<u64> {
    v.filter(|v| *v >= 0.0 && *v < 1.0e15).map(|v| v as u64)
}

#[tauri::command(async)]
pub fn restore_status() -> Result<RestoreStatus, String> {
    if !is_admin() {
        return Err("administrator rights are required".into());
    }
    let script = r#"$r=@(Get-ComputerRestorePoint -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ s=[int]$_.SequenceNumber; d=[string]$_.Description; t=[DateTimeOffset]::new($_.ConvertToDateTime($_.CreationTime)).ToUnixTimeSeconds(); y=[int]$_.RestorePointType } }); ConvertTo-Json -Compress -InputObject $r"#;
    let json = powershell(script)?;
    let raw: Vec<Raw> = serde_json::from_str(json.trim()).unwrap_or_default();
    let mut points: Vec<RestorePoint> = raw
        .into_iter()
        .map(|r| RestorePoint { sequence: r.s, description: r.d, created: r.t, kind: r.y })
        .collect();
    points.sort_by(|a, b| b.created.cmp(&a.created));

    let space = powershell(
        r#"$s=Get-CimInstance Win32_ShadowStorage -ErrorAction SilentlyContinue | Select-Object -First 1; if($s){ ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ u=[double]$s.UsedSpace; m=[double]$s.MaxSpace }) }"#,
    )
    .ok()
    .and_then(|j| serde_json::from_str::<RawSpace>(j.trim()).ok());

    Ok(RestoreStatus {
        enabled: protection_enabled() || !points.is_empty(),
        points,
        used_bytes: space.as_ref().and_then(|s| bytes(s.u)),
        max_bytes: space.as_ref().and_then(|s| bytes(s.m)),
    })
}

/// Windows allows one restore point per 24 hours by default and silently skips
/// the rest. The limit is lifted for this one call and put back afterwards.
#[tauri::command(async)]
pub fn create_restore_point(description: String) -> Result<(), String> {
    if !is_admin() {
        return Err("administrator rights are required".into());
    }
    let desc: String = description.chars().filter(|c| !c.is_control()).take(120).collect();
    let (root, _, sub) = split_reg(SR_KEY).ok_or("bad key")?;
    let key = root
        .open_subkey_with_flags(sub, KEY_READ | KEY_WRITE | KEY_WOW64_64KEY)
        .map_err(|e| e.to_string())?;
    let original: Option<u32> = key.get_value("SystemRestorePointCreationFrequency").ok();
    let _ = key.set_value("SystemRestorePointCreationFrequency", &0u32);
    let result = powershell(&format!(
        "Checkpoint-Computer -Description '{}' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop",
        desc.replace('\'', "''")
    ));
    let _ = match original {
        Some(v) => key.set_value("SystemRestorePointCreationFrequency", &v),
        None => key.delete_value("SystemRestorePointCreationFrequency"),
    };
    result.map(|_| ())
}

/// Delete restore points by sequence number. Each one is removed on its own so
/// a failure on one doesn't stop the rest; the caller gets both lists.
#[tauri::command(async)]
pub fn delete_restore_points(sequences: Vec<u32>) -> Result<RemoveResult, String> {
    if !is_admin() {
        return Err("administrator rights are required".into());
    }
    let mut deleted = Vec::new();
    let mut failed = Vec::new();
    for seq in sequences {
        // SAFETY: plain call into srclient.dll with a number.
        let code = unsafe { SRRemoveRestorePoint(seq) };
        if code == 0 {
            deleted.push(seq);
        } else {
            let msg = std::io::Error::from_raw_os_error(code as i32).to_string();
            failed.push(RemoveFailure { sequence: seq, error: format!("{msg} ({code})") });
        }
    }
    Ok(RemoveResult { deleted, failed })
}

/// Turn System Protection on for the system drive (Windows picks the size).
#[tauri::command(async)]
pub fn enable_system_protection() -> Result<(), String> {
    if !is_admin() {
        return Err("administrator rights are required".into());
    }
    powershell(r#"Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction Stop"#).map(|_| ())
}

/// Rolling back is left to Windows' own wizard: it explains what changes and
/// restarts the PC itself.
#[tauri::command]
pub fn open_system_restore() -> Result<(), String> {
    let exe = crate::util::env_path("SystemRoot")
        .map(|p| p.join(r"System32\rstrui.exe"))
        .ok_or("SystemRoot is not set")?;
    std::process::Command::new(exe).spawn().map(|_| ()).map_err(|e| e.to_string())
}
