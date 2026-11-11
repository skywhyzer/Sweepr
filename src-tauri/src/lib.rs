mod apps;
mod icons;
mod leftovers;
mod uninstall;
mod util;

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            is_elevated,
            restart_as_admin,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
