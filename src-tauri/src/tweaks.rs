//! Reversible system tweaks.
//!
//! Every tweak is a short list of registry operations. Before a tweak is
//! applied, the previous value of each touched registry value is saved in a
//! journal (`%LOCALAPPDATA%\Sweepr\tweaks.json`), so it can be put back exactly
//! as it was, even after a restart.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::RegKey;

use crate::util::{env_path, hidden, split_reg};

/// A registry value we know how to read, write and restore.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
enum Val {
    Dword(u32),
    Sz(String),
}

#[derive(Clone, Copy)]
enum V {
    D(u32),
    S(&'static str),
    /// Absolute path to the transparent icon Sweepr writes next to its journal.
    /// Used to hide an icon overlay (the shortcut arrow) without a DLL index,
    /// which differs between Windows builds and often shows a black square.
    Blank,
}

impl V {
    fn val(self) -> Val {
        match self {
            V::D(n) => Val::Dword(n),
            V::S(s) => Val::Sz(s.to_string()),
            V::Blank => Val::Sz(blank_icon_path().unwrap_or_default()),
        }
    }
}

/// One registry value touched by a tweak.
struct Op {
    path: &'static str,
    name: &'static str,
    /// Value when the tweak is enabled.
    on: V,
    /// Windows default; `None` means the value does not exist by default.
    off: Option<V>,
}

struct Tweak {
    id: &'static str,
    category: &'static str,
    /// "low" | "medium" | "high"
    risk: &'static str,
    /// Needs administrator rights (writes to HKLM).
    admin: bool,
    /// Takes effect after Explorer restarts.
    explorer: bool,
    /// Takes effect after signing out and in again.
    relogin: bool,
    ops: &'static [Op],
}

/// Tweaks that only take effect after a full restart (not just a new session).
fn needs_reboot(id: &str) -> bool {
    matches!(id, "uacOff")
}

/// `%LOCALAPPDATA%\Sweepr\blank.ico` — a fully transparent 1×1 icon.
fn blank_icon_path() -> Option<String> {
    Some(
        env_path("LOCALAPPDATA")?
            .join("Sweepr")
            .join("blank.ico")
            .to_string_lossy()
            .into_owned(),
    )
}

/// Write the transparent icon if it is not there yet, so a tweak can point an
/// icon overlay at it. The bytes are a minimal 1×1 32-bit icon whose AND mask
/// marks the single pixel transparent, which renders as nothing in Explorer.
fn ensure_blank_icon() -> Result<(), String> {
    let path = PathBuf::from(blank_icon_path().ok_or("LOCALAPPDATA is not set")?);
    if path.exists() {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    #[rustfmt::skip]
    let ico: [u8; 70] = [
        0, 0, 1, 0, 1, 0,              // ICONDIR: reserved, type=icon, count=1
        1, 1, 0, 0, 1, 0, 32, 0,       // entry: 1×1, 1 plane, 32 bpp
        48, 0, 0, 0, 22, 0, 0, 0,      // 48 bytes of image data at offset 22
        40, 0, 0, 0,                   // BITMAPINFOHEADER size
        1, 0, 0, 0, 2, 0, 0, 0,        // width=1, height=2 (XOR + AND)
        1, 0, 32, 0, 0, 0, 0, 0,       // 1 plane, 32 bpp, no compression
        0, 0, 0, 0, 0, 0, 0, 0,        // image size, X pixels-per-metre
        0, 0, 0, 0, 0, 0, 0, 0,        // Y pixels-per-metre, colours used
        0, 0, 0, 0,                    // important colours
        0, 0, 0, 0,                    // XOR: one BGRA pixel, fully clear
        128, 0, 0, 0,                  // AND: top bit set → pixel is masked out
    ];
    std::fs::write(&path, ico).map_err(|e| e.to_string())
}

const ADV: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
const CDM: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager";
const PERSONALIZE: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
const WU_AU: &str = r"HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU";

const fn op(path: &'static str, name: &'static str, on: V, off: Option<V>) -> Op {
    Op { path, name, on, off }
}

static CATALOG: &[Tweak] = &[
    // ---- Interface ----
    Tweak {
        id: "classicMenu",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32",
            "",
            V::S(""),
            None,
        )],
    },
    Tweak {
        id: "fileExt",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(ADV, "HideFileExt", V::D(0), Some(V::D(1)))],
    },
    Tweak {
        id: "hiddenFiles",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(ADV, "Hidden", V::D(1), Some(V::D(2)))],
    },
    Tweak {
        id: "thisPc",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(ADV, "LaunchTo", V::D(1), Some(V::D(2)))],
    },
    Tweak {
        id: "taskbarLeft",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(ADV, "TaskbarAl", V::D(0), Some(V::D(1)))],
    },
    Tweak {
        id: "noWidgets",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(ADV, "TaskbarDa", V::D(0), Some(V::D(1)))],
    },
    Tweak {
        id: "noTaskView",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(ADV, "ShowTaskViewButton", V::D(0), Some(V::D(1)))],
    },
    Tweak {
        id: "clockSeconds",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(ADV, "ShowSecondsInSystemClock", V::D(1), Some(V::D(0)))],
    },
    Tweak {
        id: "menuDelay",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: true,
        ops: &[op(r"HKCU\Control Panel\Desktop", "MenuShowDelay", V::S("0"), Some(V::S("400")))],
    },
    // ---- Privacy ----
    Tweak {
        id: "adId",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo",
            "Enabled",
            V::D(0),
            Some(V::D(1)),
        )],
    },
    Tweak {
        id: "noSuggestions",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[
            op(CDM, "SubscribedContent-338388Enabled", V::D(0), Some(V::D(1))),
            op(CDM, "SubscribedContent-338389Enabled", V::D(0), Some(V::D(1))),
            op(CDM, "SubscribedContent-353694Enabled", V::D(0), Some(V::D(1))),
            op(CDM, "SystemPaneSuggestionsEnabled", V::D(0), Some(V::D(1))),
            op(CDM, "SilentInstalledAppsEnabled", V::D(0), Some(V::D(1))),
        ],
    },
    Tweak {
        id: "noBingSearch",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Policies\Microsoft\Windows\Explorer",
            "DisableSearchBoxSuggestions",
            V::D(1),
            None,
        )],
    },
    Tweak {
        id: "noCopilot",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Policies\Microsoft\Windows\WindowsCopilot",
            "TurnOffWindowsCopilot",
            V::D(1),
            None,
        )],
    },
    Tweak {
        id: "noActivity",
        category: "privacy",
        risk: "low",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[
            op(r"HKLM\SOFTWARE\Policies\Microsoft\Windows\System", "PublishUserActivities", V::D(0), None),
            op(r"HKLM\SOFTWARE\Policies\Microsoft\Windows\System", "UploadUserActivities", V::D(0), None),
        ],
    },
    Tweak {
        id: "minTelemetry",
        category: "privacy",
        risk: "medium",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Policies\Microsoft\Windows\DataCollection",
            "AllowTelemetry",
            V::D(0),
            None,
        )],
    },
    // ---- Performance & gaming ----
    Tweak {
        id: "noGameDvr",
        category: "gaming",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[
            op(r"HKCU\System\GameConfigStore", "GameDVR_Enabled", V::D(0), Some(V::D(1))),
            op(
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR",
                "AppCaptureEnabled",
                V::D(0),
                Some(V::D(1)),
            ),
        ],
    },
    Tweak {
        id: "noMouseAccel",
        category: "gaming",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: true,
        ops: &[
            op(r"HKCU\Control Panel\Mouse", "MouseSpeed", V::S("0"), Some(V::S("1"))),
            op(r"HKCU\Control Panel\Mouse", "MouseThreshold1", V::S("0"), Some(V::S("6"))),
            op(r"HKCU\Control Panel\Mouse", "MouseThreshold2", V::S("0"), Some(V::S("10"))),
        ],
    },
    Tweak {
        id: "noStickyKeys",
        category: "gaming",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKCU\Control Panel\Accessibility\StickyKeys",
            "Flags",
            V::S("506"),
            Some(V::S("510")),
        )],
    },
    // ---- Updates ----
    Tweak {
        id: "noAutoReboot",
        category: "updates",
        risk: "medium",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU",
            "NoAutoRebootWithLoggedOnUsers",
            V::D(1),
            None,
        )],
    },
    // ---- Interface (added) ----
    Tweak {
        id: "noShortcutArrow",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons",
            "29",
            V::Blank,
            None,
        )],
    },
    Tweak {
        id: "darkMode",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[
            op(PERSONALIZE, "AppsUseLightTheme", V::D(0), Some(V::D(1))),
            op(PERSONALIZE, "SystemUsesLightTheme", V::D(0), Some(V::D(1))),
        ],
    },
    Tweak {
        id: "noTransparency",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(PERSONALIZE, "EnableTransparency", V::D(0), Some(V::D(1)))],
    },
    Tweak {
        id: "accentTitlebars",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Windows\DWM",
            "ColorPrevalence",
            V::D(1),
            Some(V::D(0)),
        )],
    },
    Tweak {
        id: "showTrayIcons",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: true,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer",
            "EnableAutoTray",
            V::D(0),
            Some(V::D(1)),
        )],
    },
    Tweak {
        id: "verboseStatus",
        category: "interface",
        risk: "low",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
            "VerboseStatus",
            V::D(1),
            None,
        )],
    },
    // ---- Privacy (added) ----
    Tweak {
        id: "noTailored",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Privacy",
            "TailoredExperiencesWithDiagnosticDataEnabled",
            V::D(0),
            Some(V::D(1)),
        )],
    },
    Tweak {
        id: "noOnlineSpeech",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy",
            "HasAccepted",
            V::D(0),
            Some(V::D(1)),
        )],
    },
    Tweak {
        id: "noFeedback",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Siuf\Rules",
            "NumberOfSIUFInPeriod",
            V::D(0),
            None,
        )],
    },
    Tweak {
        id: "noInkTyping",
        category: "privacy",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[
            op(
                r"HKCU\Software\Microsoft\InputPersonalization",
                "RestrictImplicitTextCollection",
                V::D(1),
                Some(V::D(0)),
            ),
            op(
                r"HKCU\Software\Microsoft\InputPersonalization",
                "RestrictImplicitInkCollection",
                V::D(1),
                Some(V::D(0)),
            ),
            op(
                r"HKCU\Software\Microsoft\Personalization\Settings",
                "AcceptedPrivacyPolicy",
                V::D(0),
                Some(V::D(1)),
            ),
        ],
    },
    Tweak {
        id: "noLocation",
        category: "privacy",
        risk: "medium",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location",
            "Value",
            V::S("Deny"),
            Some(V::S("Allow")),
        )],
    },
    Tweak {
        id: "noConsumerFeatures",
        category: "privacy",
        risk: "medium",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Policies\Microsoft\Windows\CloudContent",
            "DisableWindowsConsumerFeatures",
            V::D(1),
            None,
        )],
    },
    Tweak {
        id: "noCortana",
        category: "privacy",
        risk: "low",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Policies\Microsoft\Windows\Windows Search",
            "AllowCortana",
            V::D(0),
            None,
        )],
    },
    // ---- Performance & gaming (added) ----
    Tweak {
        id: "noStartupDelay",
        category: "gaming",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: true,
        ops: &[op(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize",
            "StartupDelayInMSec",
            V::D(0),
            None,
        )],
    },
    Tweak {
        id: "noBackgroundApps",
        category: "gaming",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications",
            "GlobalUserDisabled",
            V::D(1),
            Some(V::D(0)),
        )],
    },
    Tweak {
        id: "longPaths",
        category: "gaming",
        risk: "low",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SYSTEM\CurrentControlSet\Control\FileSystem",
            "LongPathsEnabled",
            V::D(1),
            Some(V::D(0)),
        )],
    },
    // ---- Updates (added) ----
    Tweak {
        id: "noAutoUpdate",
        category: "updates",
        risk: "high",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[
            op(WU_AU, "NoAutoUpdate", V::D(1), None),
            op(WU_AU, "AUOptions", V::D(2), None),
        ],
    },
    Tweak {
        id: "noDriverUpdates",
        category: "updates",
        risk: "medium",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate",
            "ExcludeWUDriversInQualityUpdate",
            V::D(1),
            None,
        )],
    },
    Tweak {
        id: "noStoreUpdates",
        category: "updates",
        risk: "medium",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Policies\Microsoft\WindowsStore",
            "AutoDownload",
            V::D(2),
            None,
        )],
    },
    // ---- Security ----
    Tweak {
        id: "smartScreenOff",
        category: "security",
        risk: "high",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[
            op(
                r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer",
                "SmartScreenEnabled",
                V::S("Off"),
                Some(V::S("RequireAdmin")),
            ),
            op(
                r"HKLM\SOFTWARE\Policies\Microsoft\Windows\System",
                "EnableSmartScreen",
                V::D(0),
                None,
            ),
        ],
    },
    Tweak {
        id: "uacOff",
        category: "security",
        risk: "high",
        admin: true,
        explorer: false,
        relogin: false,
        ops: &[op(
            r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
            "EnableLUA",
            V::D(0),
            Some(V::D(1)),
        )],
    },
];

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

fn read_val(path: &str, name: &str) -> Result<Option<Val>, String> {
    let Some((root, _, sub)) = split_reg(path) else {
        return Err(format!("bad registry path: {path}"));
    };
    let Ok(key) = root.open_subkey_with_flags(sub, KEY_READ | KEY_WOW64_64KEY) else {
        return Ok(None);
    };
    let raw = match key.get_raw_value(name) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    match raw.vtype {
        REG_DWORD => key
            .get_value::<u32, _>(name)
            .map(|n| Some(Val::Dword(n)))
            .map_err(|e| e.to_string()),
        REG_SZ => key
            .get_value::<String, _>(name)
            .map(|s| Some(Val::Sz(s)))
            .map_err(|e| e.to_string()),
        other => Err(format!("{path}\\{name}: unsupported value type {other:?}")),
    }
}

fn write_val(path: &str, name: &str, val: &Val) -> Result<(), String> {
    let Some((root, _, sub)) = split_reg(path) else {
        return Err(format!("bad registry path: {path}"));
    };
    let (key, _): (RegKey, _) = root
        .create_subkey_with_flags(sub, KEY_WRITE | KEY_WOW64_64KEY)
        .map_err(|e| access_error(e, path))?;
    match val {
        Val::Dword(n) => key.set_value(name, n),
        Val::Sz(s) => key.set_value(name, s),
    }
    .map_err(|e| access_error(e, path))
}

fn delete_val(path: &str, name: &str) -> Result<(), String> {
    let Some((root, _, sub)) = split_reg(path) else {
        return Err(format!("bad registry path: {path}"));
    };
    let Ok(key) = root.open_subkey_with_flags(sub, KEY_WRITE | KEY_WOW64_64KEY) else {
        return Ok(()); // key is already gone
    };
    match key.delete_value(name) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(access_error(e, path)),
    }
}

fn access_error(e: std::io::Error, path: &str) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        format!("access denied (run as administrator): {path}")
    } else {
        format!("{path}: {e}")
    }
}

fn restore(path: &str, name: &str, original: &Option<Val>) -> Result<(), String> {
    match original {
        Some(v) => write_val(path, name, v),
        None => delete_val(path, name),
    }
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Saved {
    path: String,
    name: String,
    /// Value before Sweepr touched it; `None` = did not exist.
    original: Option<Val>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Entry {
    applied: u64,
    saved: Vec<Saved>,
}

type Journal = BTreeMap<String, Entry>;

fn journal_path() -> Option<PathBuf> {
    Some(env_path("LOCALAPPDATA")?.join("Sweepr").join("tweaks.json"))
}

fn load_journal() -> Journal {
    journal_path()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_journal(j: &Journal) -> Result<(), String> {
    let path = journal_path().ok_or("LOCALAPPDATA is not set")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(j).map_err(|e| e.to_string())?;
    // Write to a temp file first so a crash never leaves a half-written journal.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakInfo {
    id: &'static str,
    category: &'static str,
    risk: &'static str,
    admin: bool,
    explorer: bool,
    relogin: bool,
    /// Needs a full restart to take effect.
    reboot: bool,
    /// Every value matches the "enabled" state.
    enabled: bool,
    /// Sweepr changed it and can restore the original.
    managed: bool,
    /// Sweepr applied it, but something has since put the old value back.
    drift: bool,
    applied: Option<u64>,
}

fn is_enabled(t: &Tweak) -> bool {
    t.ops
        .iter()
        .all(|o| matches!(read_val(o.path, o.name), Ok(Some(v)) if v == o.on.val()))
}

fn info(t: &Tweak, journal: &Journal) -> TweakInfo {
    let enabled = is_enabled(t);
    let entry = journal.get(t.id);
    TweakInfo {
        id: t.id,
        category: t.category,
        risk: t.risk,
        admin: t.admin,
        explorer: t.explorer,
        relogin: t.relogin,
        reboot: needs_reboot(t.id),
        enabled,
        managed: entry.is_some(),
        drift: entry.is_some() && !enabled,
        applied: entry.map(|e| e.applied),
    }
}

fn find(id: &str) -> Result<&'static Tweak, String> {
    CATALOG
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("unknown tweak: {id}"))
}

#[tauri::command(async)]
pub fn list_tweaks() -> Vec<TweakInfo> {
    let journal = load_journal();
    CATALOG.iter().map(|t| info(t, &journal)).collect()
}

fn enable(t: &Tweak, journal: &mut Journal) -> Result<(), String> {
    // Tweaks that hide an icon overlay need the transparent icon in place first.
    if t.ops.iter().any(|o| matches!(o.on, V::Blank)) {
        ensure_blank_icon()?;
    }
    // Read everything first: if any value has an unsupported type we bail out
    // before changing anything.
    let mut saved = Vec::new();
    for o in t.ops {
        saved.push(Saved {
            path: o.path.to_string(),
            name: o.name.to_string(),
            original: read_val(o.path, o.name)?,
        });
    }
    // Keep the oldest known originals: if the entry exists (the system undid
    // the tweak and the user re-applies it), the earlier state is the truth.
    journal.entry(t.id.to_string()).or_insert(Entry {
        applied: now_secs(),
        saved,
    });
    save_journal(journal)?;

    let mut done: Vec<&Op> = Vec::new();
    for o in t.ops {
        if let Err(e) = write_val(o.path, o.name, &o.on.val()) {
            // Undo the partial change so the tweak is all-or-nothing.
            if let Some(entry) = journal.get(t.id) {
                for d in &done {
                    if let Some(s) = entry.saved.iter().find(|s| s.path == d.path && s.name == d.name) {
                        let _ = restore(d.path, d.name, &s.original);
                    }
                }
            }
            journal.remove(t.id);
            let _ = save_journal(journal);
            return Err(e);
        }
        done.push(o);
    }
    if let Some(entry) = journal.get_mut(t.id) {
        entry.applied = now_secs();
    }
    save_journal(journal)
}

fn disable(t: &Tweak, journal: &mut Journal) -> Result<(), String> {
    let mut first_err = None;
    match journal.get(t.id).cloned() {
        // Put back exactly what was there before.
        Some(entry) => {
            for s in &entry.saved {
                if let Err(e) = restore(&s.path, &s.name, &s.original) {
                    first_err.get_or_insert(e);
                }
            }
        }
        // Enabled outside Sweepr: fall back to the Windows default.
        None => {
            for o in t.ops {
                let r = match o.off {
                    Some(v) => write_val(o.path, o.name, &v.val()),
                    None => delete_val(o.path, o.name),
                };
                if let Err(e) = r {
                    first_err.get_or_insert(e);
                }
            }
        }
    }
    if let Some(e) = first_err {
        return Err(e); // keep the journal so the user can try again
    }
    journal.remove(t.id);
    save_journal(journal)
}

fn check_admin(t: &Tweak) -> Result<(), String> {
    if t.admin && !unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() } {
        return Err("administrator rights are required for this tweak".into());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn set_tweak(id: String, enabled: bool) -> Result<TweakInfo, String> {
    let t = find(&id)?;
    check_admin(t)?;
    let mut journal = load_journal();
    if enabled {
        enable(t, &mut journal)?;
    } else {
        disable(t, &mut journal)?;
    }
    Ok(info(t, &journal))
}

/// Undo every tweak Sweepr has made. Returns how many were restored.
#[tauri::command(async)]
pub fn reset_tweaks() -> Result<u32, String> {
    let mut journal = load_journal();
    let ids: Vec<String> = journal.keys().cloned().collect();
    let mut restored = 0;
    let mut errors = Vec::new();
    for id in ids {
        let Ok(t) = find(&id) else {
            journal.remove(&id);
            continue;
        };
        if let Err(e) = check_admin(t).and_then(|_| disable(t, &mut journal)) {
            errors.push(e);
        } else {
            restored += 1;
        }
    }
    let _ = save_journal(&journal);
    if errors.is_empty() {
        Ok(restored)
    } else {
        Err(errors.join("\n"))
    }
}

#[tauri::command(async)]
pub fn restart_explorer() -> Result<(), String> {
    let mut kill = Command::new("taskkill");
    kill.args(["/F", "/IM", "explorer.exe"]);
    hidden(&mut kill).output().map_err(|e| e.to_string())?;
    // Windows normally restarts the shell by itself; make sure it did.
    std::thread::sleep(std::time::Duration::from_millis(1200));
    let running = {
        let mut q = Command::new("tasklist");
        q.args(["/FI", "IMAGENAME eq explorer.exe", "/NH"]);
        hidden(&mut q)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains("explorer.exe"))
            .unwrap_or(false)
    };
    if !running {
        Command::new("explorer.exe")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = r"HKCU\Software\SweeprTweakTest";

    fn cleanup() {
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(r"Software\SweeprTweakTest");
    }

    static TEST_TWEAK: Tweak = Tweak {
        id: "__test",
        category: "interface",
        risk: "low",
        admin: false,
        explorer: false,
        relogin: false,
        ops: &[
            op(KEY, "Existing", V::D(1), Some(V::D(0))),
            op(KEY, "Missing", V::S("x"), None),
        ],
    };

    #[test]
    fn apply_and_revert_restores_original_state() {
        cleanup();
        write_val(KEY, "Existing", &Val::Dword(42)).unwrap();

        let mut j = Journal::new();
        enable(&TEST_TWEAK, &mut j).unwrap();
        assert!(is_enabled(&TEST_TWEAK));
        assert_eq!(read_val(KEY, "Missing").unwrap(), Some(Val::Sz("x".into())));

        // Re-applying after drift must keep the *first* original.
        write_val(KEY, "Existing", &Val::Dword(7)).unwrap();
        assert!(!is_enabled(&TEST_TWEAK));
        enable(&TEST_TWEAK, &mut j).unwrap();

        disable(&TEST_TWEAK, &mut j).unwrap();
        assert_eq!(read_val(KEY, "Existing").unwrap(), Some(Val::Dword(42)));
        assert_eq!(read_val(KEY, "Missing").unwrap(), None);
        assert!(j.is_empty());

        cleanup();
        // The journal file must not have been left with the test entry.
        assert!(!load_journal().contains_key("__test"));
    }
}
