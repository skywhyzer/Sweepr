//! Device drivers: what is installed, which devices have a problem, and driver
//! updates from Windows Update.
//!
//! Updates come only from Windows Update (the same source as Settings →
//! Windows Update → Optional updates), so every driver offered is one that
//! Microsoft has tested and signed. Nothing is downloaded from third-party
//! sites.

use serde::{Deserialize, Serialize};

use crate::util::{is_admin, powershell};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    device: String,
    /// Device class as Windows names it ("Display", "Net", "MEDIA"…).
    class: String,
    manufacturer: String,
    provider: String,
    version: String,
    /// Driver date, seconds since the Unix epoch (0 when unknown).
    date: i64,
    inf: String,
    signed: bool,
    device_id: String,
    /// Device Manager problem code; 0 means the device works.
    problem: u32,
}

#[derive(Deserialize)]
struct RawDriver {
    #[serde(default)]
    n: Option<String>,
    #[serde(default)]
    c: Option<String>,
    #[serde(default)]
    m: Option<String>,
    #[serde(default)]
    p: Option<String>,
    #[serde(default)]
    v: Option<String>,
    #[serde(default)]
    t: Option<i64>,
    #[serde(default)]
    i: Option<String>,
    #[serde(default)]
    s: Option<bool>,
    #[serde(default)]
    d: Option<String>,
    #[serde(default)]
    e: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverUpdate {
    id: String,
    title: String,
    manufacturer: String,
    class: String,
    model: String,
    /// Driver date, seconds since the Unix epoch.
    date: i64,
    size_bytes: u64,
}

#[derive(Deserialize)]
struct RawUpdate {
    id: String,
    t: Option<String>,
    m: Option<String>,
    c: Option<String>,
    o: Option<String>,
    d: Option<i64>,
    z: Option<f64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallItem {
    id: String,
    title: String,
    /// Windows Update result code: 2 succeeded, 3 succeeded with errors,
    /// 4 failed, 5 aborted.
    code: i32,
    hresult: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    reboot: bool,
    items: Vec<InstallItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    folder: String,
    output: String,
}

/// JSON from PowerShell may be a single object instead of a list.
fn json_list<T: for<'de> Deserialize<'de>>(text: &str) -> Vec<T> {
    let t = text.trim();
    if t.is_empty() {
        return Vec::new();
    }
    serde_json::from_str::<Vec<T>>(t)
        .or_else(|_| serde_json::from_str::<T>(t).map(|one| vec![one]))
        .unwrap_or_default()
}

/// Installed drivers, plus devices that have no driver at all (they only
/// show up with a problem code).
#[tauri::command(async)]
pub fn list_drivers() -> Result<Vec<DriverInfo>, String> {
    let script = r#"
$ent=@{}; Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | ForEach-Object { if($_.PNPDeviceID){ $ent[$_.PNPDeviceID]=$_ } }
$seen=@{}
$out=New-Object System.Collections.ArrayList
Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object { $_.DeviceName -and $_.DeviceID } | ForEach-Object {
  $e=$ent[$_.DeviceID]; $seen[$_.DeviceID]=1
  $t=0; if($_.DriverDate){ $t=[DateTimeOffset]::new($_.DriverDate).ToUnixTimeSeconds() }
  [void]$out.Add([pscustomobject]@{ n=[string]$_.DeviceName; c=[string]$_.DeviceClass; m=[string]$_.Manufacturer; p=[string]$_.DriverProviderName; v=[string]$_.DriverVersion; t=$t; i=[string]$_.InfName; s=[bool]$_.IsSigned; d=[string]$_.DeviceID; e=$(if($e){[int]$e.ConfigManagerErrorCode}else{0}) })
}
foreach($k in $ent.Keys){ $e=$ent[$k]; if(-not $seen[$k] -and $e.ConfigManagerErrorCode -and $e.Present){
  [void]$out.Add([pscustomobject]@{ n=[string]$(if($e.Name){$e.Name}else{$k}); c=[string]$e.PNPClass; m=[string]$e.Manufacturer; p=''; v=''; t=0; i=''; s=$false; d=[string]$k; e=[int]$e.ConfigManagerErrorCode })
} }
ConvertTo-Json -Compress -Depth 2 -InputObject @($out)
"#;
    let json = powershell(script)?;
    let raw: Vec<RawDriver> = json_list(&json);
    let mut list: Vec<DriverInfo> = raw
        .into_iter()
        .map(|r| DriverInfo {
            device: r.n.unwrap_or_default(),
            class: r.c.unwrap_or_default(),
            manufacturer: r.m.unwrap_or_default(),
            provider: r.p.unwrap_or_default(),
            version: r.v.unwrap_or_default(),
            date: r.t.unwrap_or(0),
            inf: r.i.unwrap_or_default(),
            signed: r.s.unwrap_or(false),
            device_id: r.d.unwrap_or_default(),
            problem: r.e.unwrap_or(0),
        })
        .filter(|d| !d.device.is_empty())
        .collect();
    list.sort_by(|a, b| {
        a.class
            .to_lowercase()
            .cmp(&b.class.to_lowercase())
            .then(a.device.to_lowercase().cmp(&b.device.to_lowercase()))
    });
    Ok(list)
}

const SEARCH: &str = "IsInstalled=0 and Type='Driver' and IsHidden=0";

/// Ask Windows Update which driver updates it has for this PC. This can take
/// a minute or two: Windows Update checks every device.
#[tauri::command(async)]
pub fn scan_driver_updates() -> Result<Vec<DriverUpdate>, String> {
    let script = format!(
        r#"
$s=New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID='Sweepr'
$r=$s.CreateUpdateSearcher().Search("{SEARCH}")
$o=@($r.Updates | ForEach-Object {{
  $d=0; if($_.DriverVerDate){{ $d=[DateTimeOffset]::new($_.DriverVerDate).ToUnixTimeSeconds() }}
  [pscustomobject]@{{ id=[string]$_.Identity.UpdateID; t=[string]$_.Title; m=[string]$_.DriverManufacturer; c=[string]$_.DriverClass; o=[string]$_.DriverModel; d=$d; z=[double]$_.MaxDownloadSize }}
}})
ConvertTo-Json -Compress -InputObject $o
"#
    );
    let json = powershell(&script)?;
    let raw: Vec<RawUpdate> = json_list(&json);
    Ok(raw
        .into_iter()
        .map(|r| DriverUpdate {
            id: r.id,
            title: r.t.unwrap_or_default(),
            manufacturer: r.m.unwrap_or_default(),
            class: r.c.unwrap_or_default(),
            model: r.o.unwrap_or_default(),
            date: r.d.unwrap_or(0),
            size_bytes: r.z.filter(|z| *z > 0.0 && *z < 1.0e12).map(|z| z as u64).unwrap_or(0),
        })
        .collect())
}

/// Windows Update ids are GUIDs; nothing else gets into the script.
fn is_guid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Download and install the chosen driver updates through Windows Update.
#[tauri::command(async)]
pub fn install_driver_updates(ids: Vec<String>) -> Result<InstallResult, String> {
    if !is_admin() {
        return Err("administrator rights are required".into());
    }
    let ids: Vec<String> = ids.into_iter().filter(|i| is_guid(i)).collect();
    if ids.is_empty() {
        return Ok(InstallResult { reboot: false, items: Vec::new() });
    }
    let want = ids.iter().map(|i| format!("'{i}'")).collect::<Vec<_>>().join(",");
    let script = format!(
        r#"
$s=New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID='Sweepr'
$r=$s.CreateUpdateSearcher().Search("{SEARCH}")
$want=@({want})
$c=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $r.Updates){{ if($want -contains [string]$u.Identity.UpdateID){{ if(-not $u.EulaAccepted){{ $u.AcceptEula() }}; [void]$c.Add($u) }} }}
if($c.Count -eq 0){{ ConvertTo-Json -Compress -InputObject ([pscustomobject]@{{ reboot=$false; items=@() }}); exit }}
$dl=$s.CreateUpdateDownloader(); $dl.Updates=$c; [void]$dl.Download()
$in=$s.CreateUpdateInstaller(); $in.Updates=$c; $res=$in.Install()
$items=@(for($k=0;$k -lt $c.Count;$k++){{ $ur=$res.GetUpdateResult($k); [pscustomobject]@{{ id=[string]$c.Item($k).Identity.UpdateID; title=[string]$c.Item($k).Title; code=[int]$ur.ResultCode; hresult=[int64]$ur.HResult }} }})
ConvertTo-Json -Compress -Depth 3 -InputObject ([pscustomobject]@{{ reboot=[bool]$res.RebootRequired; items=$items }})
"#
    );
    let json = powershell(&script)?;
    serde_json::from_str(json.trim()).map_err(|e| format!("{e}: {}", json.trim()))
}

/// Copy every third-party driver package to Documents\Sweepr\Drivers <date>,
/// so they can be put back with pnputil or Device Manager after a reinstall
/// or a bad update.
#[tauri::command(async)]
pub fn export_drivers() -> Result<ExportResult, String> {
    if !is_admin() {
        return Err("administrator rights are required".into());
    }
    let docs = crate::util::env_path("USERPROFILE").ok_or("USERPROFILE is not set")?.join("Documents");
    let stamp = chrono_stamp();
    let folder = docs.join("Sweepr").join(format!("Drivers {stamp}"));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new("pnputil.exe");
    cmd.arg("/export-driver").arg("*").arg(&folder);
    let (ok, text) = crate::util::run_console(&mut cmd)?;
    let tail: Vec<&str> = text.lines().rev().take(8).collect();
    let output = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
    if ok {
        Ok(ExportResult { folder: folder.to_string_lossy().into_owned(), output })
    } else {
        Err(output)
    }
}

/// "2026-11-12 0715" from the local clock, without pulling in a date crate.
fn chrono_stamp() -> String {
    powershell("Get-Date -Format 'yyyy-MM-dd HHmm'")
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c == '-' || c == ' '))
        .unwrap_or_else(|| "backup".into())
}

#[tauri::command]
pub fn open_device_manager() -> Result<(), String> {
    std::process::Command::new("mmc.exe")
        .arg("devmgmt.msc")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Talks to the real system; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn live_list_and_scan() {
        let list = list_drivers().expect("list");
        assert!(list.len() > 10, "only {} devices", list.len());
        println!("devices: {}, problems: {}", list.len(), list.iter().filter(|d| d.problem != 0).count());
        let ups = scan_driver_updates().expect("scan");
        for u in &ups {
            println!("update: {} | {} | {}", u.model, u.manufacturer, u.size_bytes);
        }
    }

    #[test]
    fn guids_only() {
        assert!(is_guid("0d2e2c0a-1b2c-4d5e-8f90-a1b2c3d4e5f6"));
        assert!(!is_guid("'); Remove-Item C:\\ -Recurse; ('"));
        assert!(!is_guid("short"));
    }

    #[test]
    fn single_object_json_is_a_list() {
        let one = r#"{"id":"0d2e2c0a-1b2c-4d5e-8f90-a1b2c3d4e5f6","t":"Intel - Display - 31.0","m":"Intel","c":"Display","o":"Intel UHD","d":1700000000,"z":12345.0}"#;
        let v: Vec<RawUpdate> = json_list(one);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].m.as_deref(), Some("Intel"));
    }
}
