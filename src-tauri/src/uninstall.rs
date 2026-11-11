use std::ffi::c_void;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    QueryInformationJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
};

use winreg::enums::KEY_READ;

use crate::apps::AppInfo;
use crate::util::{hidden, open_reg, powershell};

/// Uninstall strings are sometimes an unquoted path with spaces; quote the exe part.
fn fix_command_line(raw: &str) -> String {
    let s = raw.trim();
    if s.starts_with('"') {
        return s.to_string();
    }
    if let Some(idx) = s.to_lowercase().find(".exe") {
        let (exe, rest) = s.split_at(idx + 4);
        if exe.contains(' ') && Path::new(exe).is_file() {
            return format!("\"{exe}\"{rest}");
        }
    }
    s.to_string()
}

/// True when the command clearly points at an executable that no longer exists.
fn uninstaller_missing(line: &str) -> bool {
    if line.contains('%') {
        return false; // unexpanded variables: let cmd resolve them
    }
    let exe = if let Some(rest) = line.strip_prefix('"') {
        rest.split('"').next().unwrap_or("")
    } else if let Some(idx) = line.to_lowercase().find(".exe") {
        &line[..idx + 4]
    } else {
        return false;
    };
    let path = Path::new(exe);
    path.is_absolute() && !path.exists()
}

fn ps_quote(s: &str) -> String {
    s.replace('\'', "''")
}

/// Runs the program's own uninstaller and waits for it to exit.
/// Returns the process exit code.
#[tauri::command(async)]
pub fn run_uninstaller(app: AppInfo) -> Result<i32, String> {
    if app.kind == "store" {
        let full = app
            .package_full_name
            .as_deref()
            .ok_or("missing package name")?;
        powershell(&format!(
            "Remove-AppxPackage -Package '{}' -ErrorAction Stop",
            ps_quote(full)
        ))?;
        return Ok(0);
    }

    let mut cmd;
    if let (true, Some(code)) = (app.is_msi, app.product_code.as_deref()) {
        if !code.starts_with('{') || !code.ends_with('}') || code.contains(' ') {
            return Err("invalid product code".into());
        }
        cmd = Command::new("msiexec.exe");
        cmd.args(["/x", code, "/passive", "/norestart"]);
    } else {
        let line = app
            .quiet_uninstall_string
            .as_deref()
            .or(app.uninstall_string.as_deref())
            .ok_or("no uninstall command")?;
        if uninstaller_missing(&fix_command_line(line)) {
            return Err("UNINSTALLER_MISSING".into());
        }
        cmd = Command::new("cmd.exe");
        // /S makes cmd strip exactly the outer quotes and run the rest verbatim.
        cmd.raw_arg("/S")
            .raw_arg("/C")
            .raw_arg(format!("\"{}\"", fix_command_line(line)));
    }
    run_and_wait_tree(&mut cmd)
}

/// Starts the command and waits for it AND every process it spawns.
/// Installers (NSIS, Inno Setup…) copy themselves to a temp folder and the
/// original process exits at once, so waiting on it alone is not enough.
/// All descendants share a job object; we wait until the job is empty.
fn run_and_wait_tree(cmd: &mut Command) -> Result<i32, String> {
    let mut child = hidden(cmd).spawn().map_err(|e| e.to_string())?;
    let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.ok();
    let tracked = job
        .map(|j| unsafe { AssignProcessToJobObject(j, HANDLE(child.as_raw_handle() as _)) }.is_ok())
        .unwrap_or(false);

    let status = child.wait().map_err(|e| e.to_string())?;

    if let Some(job) = job {
        while tracked {
            let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let ok = unsafe {
                QueryInformationJobObject(
                    Some(job),
                    JobObjectBasicAccountingInformation,
                    &mut info as *mut _ as *mut c_void,
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    None,
                )
            }
            .is_ok();
            if !ok || info.ActiveProcesses == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(300));
        }
        let _ = unsafe { CloseHandle(job) };
    }
    Ok(status.code().unwrap_or(-1))
}

/// Whether the program is still registered in the system.
#[tauri::command(async)]
pub fn is_installed(app: AppInfo) -> bool {
    if app.kind == "store" {
        let Some(full) = app.package_full_name.as_deref() else {
            return false;
        };
        return powershell(&format!(
            "if (Get-AppxPackage | Where-Object PackageFullName -eq '{}') {{ 'yes' }}",
            ps_quote(full)
        ))
        .map(|out| out.contains("yes"))
        .unwrap_or(false);
    }
    match app.registry_key.as_deref() {
        Some(key) => open_reg(key, KEY_READ).is_some(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// The launcher exits at once but leaves a background child behind,
    /// like an NSIS uninstaller does; we must wait for the child too.
    #[test]
    fn waits_for_child_processes() {
        let mut cmd = Command::new("cmd.exe");
        cmd.raw_arg("/S")
            .raw_arg("/C")
            .raw_arg("\"start \"\" /B ping -n 4 127.0.0.1 >nul\"");
        let started = Instant::now();
        let code = run_and_wait_tree(&mut cmd).unwrap();
        let elapsed = started.elapsed();
        println!("exit {code}, waited {elapsed:?}");
        assert!(elapsed >= Duration::from_secs(2));
    }
}
