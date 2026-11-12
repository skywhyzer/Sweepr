mod apps;
mod cleanup;
mod disk;
mod disktree;
mod drivers;
mod icons;
mod leftovers;
mod look;
mod orphans;
mod repair;
mod restore;
mod startup;
mod tweaks;
mod uninstall;
mod util;
mod winget;

use std::time::Duration;

use tauri::Manager;
use windows::core::{w, PCWSTR};
use windows::Win32::UI::Shell::{IsUserAnAdmin, ShellExecuteW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[tauri::command]
fn is_elevated() -> bool {
    unsafe { IsUserAnAdmin().as_bool() }
}

/// Relaunch the app elevated (UAC prompt) and close this instance.
#[tauri::command]
fn restart_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let file = util::wide(&exe.to_string_lossy());
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("runas"),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result.0 as isize) <= 32 {
        return Err("elevation was cancelled".into());
    }
    app.exit(0);
    Ok(())
}

/// Show a program's folder in Explorer; for a file, open its folder with the
/// file selected.
#[tauri::command]
fn open_location(path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let p = std::path::Path::new(path.trim().trim_matches('"'));
    let mut cmd = std::process::Command::new("explorer.exe");
    if p.is_dir() {
        cmd.arg(p);
    } else if p.is_file() {
        // raw_arg keeps the quotes exactly as Explorer expects them.
        cmd.raw_arg(format!("/select,\"{}\"", p.display()));
    } else {
        return Err("path not found".into());
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Open a web page in the default browser. Only plain http(s) links.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let u = url.trim();
    let ok_scheme = u.starts_with("https://") || u.starts_with("http://");
    if !ok_scheme || u.len() > 2000 || u.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"') {
        return Err("bad url".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(u)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(disk::DiskState::default())
        .setup(|app| {
            // The window starts hidden and the frontend shows it after its first
            // paint, so there is no white flash. If the page never gets that far,
            // show it anyway rather than leave an invisible process behind.
            if let Some(win) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    let _ = win.show();
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_elevated,
            restart_as_admin,
            look::system_look,
            open_location,
            open_url,
            startup::list_startup,
            startup::set_startup,
            startup::remove_startup,
            cleanup::scan_cleanup,
            cleanup::run_cleanup,
            cleanup::open_storage_settings,
            orphans::scan_orphans,
            restore::restore_status,
            restore::create_restore_point,
            restore::delete_restore_points,
            restore::enable_system_protection,
            restore::open_system_restore,
            repair::run_repair,
            winget::winget_updates,
            winget::winget_upgrade,
            winget::winget_info,
            drivers::list_drivers,
            drivers::scan_driver_updates,
            drivers::install_driver_updates,
            drivers::export_drivers,
            drivers::open_device_manager,
            apps::list_win32_apps,
            apps::list_store_apps,
            icons::get_icon,
            uninstall::run_uninstaller,
            uninstall::is_installed,
            leftovers::scan_leftovers,
            leftovers::delete_leftovers,
            leftovers::list_backups,
            leftovers::restore_backup,
            leftovers::delete_backup,
            tweaks::list_tweaks,
            tweaks::set_tweak,
            tweaks::reset_tweaks,
            tweaks::restart_explorer,
            disk::disk_drives,
            disk::disk_scan,
            disk::disk_cancel,
            disk::disk_close,
            disk::disk_item,
            disk::disk_children,
            disk::disk_ancestry,
            disk::disk_ext_stats,
            disk::disk_top_files,
            disk::disk_treemap,
            disk::disk_path,
            disk::disk_reveal,
            disk::disk_open,
            disk::disk_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
