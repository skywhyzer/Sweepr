//! System look: the user's accent colour and whether Mica is available, so the
//! frontend can match Windows instead of shipping its own palette.

use serde::Serialize;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLook {
    /// Windows build number (22000+ is Windows 11, which has Mica).
    pub build: u32,
    /// Accent for the light theme (SystemAccentColorDark1), `#rrggbb`.
    pub accent_light: Option<String>,
    /// Accent for the dark theme (SystemAccentColorLight2), `#rrggbb`.
    pub accent_dark: Option<String>,
}

pub fn windows_build() -> u32 {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// `AccentPalette` holds eight RGBA swatches, lightest first:
/// Light3, Light2, Light1, Accent, Dark1, Dark2, Dark3, (unused).
fn accent_palette() -> Option<Vec<u8>> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent")
        .ok()?;
    let raw = key.get_raw_value("AccentPalette").ok()?;
    let bytes: &[u8] = &raw.bytes;
    (bytes.len() >= 28).then(|| bytes.to_vec())
}

fn swatch(p: &[u8], i: usize) -> String {
    format!("#{:02x}{:02x}{:02x}", p[i * 4], p[i * 4 + 1], p[i * 4 + 2])
}

#[tauri::command]
pub fn system_look() -> SystemLook {
    let palette = accent_palette();
    SystemLook {
        build: windows_build(),
        accent_light: palette.as_deref().map(|p| swatch(p, 4)),
        accent_dark: palette.as_deref().map(|p| swatch(p, 1)),
    }
}
