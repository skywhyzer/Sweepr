//! Repair toolkit: the standard Windows fixes, each a single well-known
//! command run without a console window, with its output shown afterwards.

use std::process::Command;

use serde::Serialize;

use crate::util::{env_path, is_admin, powershell, run_console};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    ok: bool,
    /// The last lines of what the tools printed.
    output: String,
    /// A restart is needed for the fix to take effect.
    reboot: bool,
}

/// Actions and whether they need administrator rights.
pub const ACTIONS: &[(&str, bool)] = &[
    ("sfc", true),
    ("dism", true),
    ("componentCleanup", true),
    ("network", true),
    ("dns", false),
    ("windowsUpdate", true),
    ("iconCache", false),
    ("explorer", false),
];

fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

fn run(program: &str, args: &[&str]) -> Result<(bool, String), String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    run_console(&mut cmd)
}

/// Several commands in a row; stops at the first failure.
fn run_all(steps: &[(&str, &[&str])]) -> Result<(bool, String), String> {
    let mut out = String::new();
    for (program, args) in steps {
        let (ok, text) = run(program, args)?;
        out.push_str(&format!("> {program} {}\n{text}\n", args.join(" ")));
        if !ok {
            return Ok((false, out));
        }
    }
    Ok((true, out))
}

/// Stop the update services, move their caches aside (renamed, not deleted)
/// and start the services again. Windows rebuilds both folders.
const WU_RESET: &str = r#"
$ErrorActionPreference='Continue'
$svc='wuauserv','bits','cryptsvc','msiserver'
foreach($s in $svc){ Stop-Service -Name $s -Force -ErrorAction SilentlyContinue }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
foreach($p in "$env:SystemRoot\SoftwareDistribution","$env:SystemRoot\System32\catroot2"){
  Get-ChildItem -Path (Split-Path $p) -Filter ((Split-Path $p -Leaf)+'.sweepr-*') -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  if(Test-Path $p){ Rename-Item -Path $p -NewName ((Split-Path $p -Leaf)+'.sweepr-'+$stamp) -ErrorAction Continue; "Renamed $p" }
}
foreach($s in $svc){ Start-Service -Name $s -ErrorAction SilentlyContinue }
'Windows Update components were reset.'
"#;

fn rebuild_icon_cache() -> Result<(bool, String), String> {
    let mut kill = Command::new("taskkill");
    kill.args(["/F", "/IM", "explorer.exe"]);
    let _ = run_console(&mut kill);
    std::thread::sleep(std::time::Duration::from_millis(800));
    let mut removed = 0;
    if let Some(la) = env_path("LOCALAPPDATA") {
        if std::fs::remove_file(la.join("IconCache.db")).is_ok() {
            removed += 1;
        }
        if let Ok(rd) = std::fs::read_dir(la.join(r"Microsoft\Windows\Explorer")) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_lowercase();
                if (name.starts_with("iconcache_") || name.starts_with("thumbcache_")) && name.ends_with(".db")
                    && std::fs::remove_file(e.path()).is_ok()
                {
                    removed += 1;
                }
            }
        }
    }
    let _ = Command::new("explorer.exe").spawn();
    Ok((true, format!("Removed {removed} cache files; Explorer restarted.")))
}

#[tauri::command(async)]
pub fn run_repair(id: String) -> Result<RepairResult, String> {
    let Some((_, admin)) = ACTIONS.iter().find(|(a, _)| *a == id) else {
        return Err("unknown action".into());
    };
    if *admin && !is_admin() {
        return Err("administrator rights are required".into());
    }
    let mut reboot = false;
    let (ok, text) = match id.as_str() {
        "sfc" => run("sfc.exe", &["/scannow"])?,
        "dism" => run("DISM.exe", &["/Online", "/Cleanup-Image", "/RestoreHealth"])?,
        "componentCleanup" => run("DISM.exe", &["/Online", "/Cleanup-Image", "/StartComponentCleanup"])?,
        "network" => {
            reboot = true;
            run_all(&[
                ("netsh", &["winsock", "reset"]),
                ("netsh", &["int", "ip", "reset"]),
                ("ipconfig", &["/flushdns"]),
            ])?
        }
        "dns" => run("ipconfig", &["/flushdns"])?,
        "windowsUpdate" => match powershell(WU_RESET) {
            Ok(t) => (true, t),
            Err(e) => (false, e),
        },
        "iconCache" => rebuild_icon_cache()?,
        "explorer" => {
            crate::tweaks::restart_explorer()?;
            (true, String::new())
        }
        _ => unreachable!(),
    };
    Ok(RepairResult { ok, output: tail(&text, 40), reboot })
}
