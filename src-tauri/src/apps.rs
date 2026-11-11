use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use windows::core::PCWSTR;
use windows::Win32::UI::Shell::SHLoadIndirectString;
use winreg::enums::*;
use winreg::RegKey;

use crate::util::{clean_path, norm, powershell, wide};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub id: String,
    /// "win32" or "store"
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub install_location: Option<String>,
    #[serde(default)]
    pub uninstall_string: Option<String>,
    #[serde(default)]
    pub quiet_uninstall_string: Option<String>,
    #[serde(default)]
    pub icon_path: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    /// YYYY-MM-DD
    #[serde(default)]
    pub install_date: Option<String>,
    /// Full path of the uninstall entry, e.g. "HKLM\SOFTWARE\...\Uninstall\Foo"
    #[serde(default)]
    pub registry_key: Option<String>,
    #[serde(default)]
    pub is_msi: bool,
    #[serde(default)]
    pub product_code: Option<String>,
    #[serde(default)]
    pub package_full_name: Option<String>,
    #[serde(default)]
    pub package_family_name: Option<String>,
}

const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
const UNINSTALL32: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

fn read_str(key: &RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn read_u32(key: &RegKey, name: &str) -> Option<u32> {
    key.get_value::<u32, _>(name).ok()
}

fn format_date(raw: &str) -> Option<String> {
    let d: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if d.len() != 8 {
        return None;
    }
    let (y, m, day) = (&d[0..4], &d[4..6], &d[6..8]);
    let (mi, di) = (m.parse::<u32>().ok()?, day.parse::<u32>().ok()?);
    if !(1..=12).contains(&mi) || !(1..=31).contains(&di) {
        return None;
    }
    Some(format!("{y}-{m}-{day}"))
}

/// When the registry has no DisplayIcon, try the main executable in the install folder.
fn guess_icon(install: &str, name: &str) -> Option<String> {
    let wanted = norm(name);
    let mut exes: Vec<PathBuf> = std::fs::read_dir(install)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .map(|e| e.eq_ignore_ascii_case("exe"))
                .unwrap_or(false)
        })
        .take(40)
        .collect();
    exes.sort();
    let named = exes.iter().find(|p| {
        let stem = norm(&p.file_stem().unwrap_or_default().to_string_lossy());
        stem.len() >= 3
            && !stem.starts_with("unins")
            && (wanted.contains(&stem) || stem.contains(&wanted))
    });
    let pick = named.or_else(|| if exes.len() == 1 { exes.first() } else { None })?;
    Some(pick.to_string_lossy().into_owned())
}

pub fn list_win32() -> Vec<AppInfo> {
    let sources = [
        ("HKLM", HKEY_LOCAL_MACHINE, UNINSTALL),
        ("HKLM", HKEY_LOCAL_MACHINE, UNINSTALL32),
        ("HKCU", HKEY_CURRENT_USER, UNINSTALL),
    ];
    let mut apps = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for (hive_name, hive, base) in sources {
        let Ok(root) =
            RegKey::predef(hive).open_subkey_with_flags(base, KEY_READ | KEY_WOW64_64KEY)
        else {
            continue;
        };
        for sub in root.enum_keys().flatten() {
            let Ok(key) = root.open_subkey_with_flags(&sub, KEY_READ) else {
                continue;
            };
            let Some(name) = read_str(&key, "DisplayName") else {
                continue;
            };
            if read_u32(&key, "SystemComponent") == Some(1) {
                continue;
            }
            if read_str(&key, "ParentKeyName").is_some() {
                continue;
            }
            if let Some(rt) = read_str(&key, "ReleaseType") {
                let rt = rt.to_lowercase();
                if rt.contains("update") || rt.contains("hotfix") {
                    continue;
                }
            }
            let is_msi = read_u32(&key, "WindowsInstaller") == Some(1) && sub.starts_with('{');
            let uninstall_string = read_str(&key, "UninstallString");
            if uninstall_string.is_none() && !is_msi {
                continue;
            }
            let version = read_str(&key, "DisplayVersion");
            let dedupe = format!(
                "{}|{}",
                name.to_lowercase(),
                version.clone().unwrap_or_default()
            );
            if !seen.insert(dedupe) {
                continue;
            }

            let install_location = read_str(&key, "InstallLocation")
                .and_then(|s| clean_path(&s))
                .filter(|s| Path::new(s).is_absolute());
            let icon_path = read_str(&key, "DisplayIcon").or_else(|| {
                install_location
                    .as_deref()
                    .and_then(|loc| guess_icon(loc, &name))
            });
            let install_date = read_str(&key, "InstallDate")
                .and_then(|s| format_date(&s))
                .or_else(|| {
                    let t = key.query_info().ok()?.get_last_write_time_system();
                    Some(format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay))
                });
            let registry_key = format!("{hive_name}\\{base}\\{sub}");

            apps.push(AppInfo {
                id: registry_key.clone(),
                kind: "win32".into(),
                name,
                publisher: read_str(&key, "Publisher"),
                version,
                install_location,
                uninstall_string,
                quiet_uninstall_string: read_str(&key, "QuietUninstallString"),
                icon_path,
                size_bytes: read_u32(&key, "EstimatedSize")
                    .filter(|kb| *kb > 0)
                    .map(|kb| kb as u64 * 1024),
                install_date,
                registry_key: Some(registry_key),
                is_msi,
                product_code: if is_msi { Some(sub.clone()) } else { None },
                package_full_name: None,
                package_family_name: None,
            });
        }
    }
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

#[tauri::command(async)]
pub fn list_win32_apps() -> Vec<AppInfo> {
    list_win32()
}

// ---------------------------------------------------------------- Store apps

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawPackage {
    name: String,
    package_full_name: String,
    package_family_name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    install_location: Option<String>,
}

fn xml_tag(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&format!("</{name}>"))?;
    Some(xml[start..start + end].trim().to_string())
}

fn xml_attr(xml: &str, name: &str) -> Option<String> {
    let pat = format!("{name}=\"");
    let start = xml.find(&pat)? + pat.len();
    let end = xml[start..].find('"')?;
    Some(xml[start..start + end].to_string())
}

fn load_indirect(source: &str) -> Option<String> {
    let src = wide(source);
    let mut buf = [0u16; 512];
    unsafe { SHLoadIndirectString(PCWSTR(src.as_ptr()), &mut buf, None).ok()? };
    let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    let s = String::from_utf16_lossy(&buf[..len]).trim().to_string();
    if s.is_empty() || s.starts_with("ms-resource") {
        None
    } else {
        Some(s)
    }
}

/// Resolve "ms-resource:Foo" manifest strings to the localized text.
fn resolve_resource(value: &str, full_name: &str, name: &str) -> Option<String> {
    let Some(key) = value.strip_prefix("ms-resource:") else {
        return Some(value.to_string()).filter(|s| !s.is_empty());
    };
    let candidates = if key.starts_with("//") {
        vec![format!("ms-resource:{key}")]
    } else if let Some(rest) = key.strip_prefix('/') {
        vec![format!("ms-resource://{name}/{rest}")]
    } else if key.contains('/') {
        vec![
            format!("ms-resource://{name}/{key}"),
            format!("ms-resource://{name}/resources/{key}"),
        ]
    } else {
        vec![
            format!("ms-resource://{name}/resources/{key}"),
            format!("ms-resource://{name}/{key}"),
        ]
    };
    candidates
        .iter()
        .find_map(|c| load_indirect(&format!("@{{{full_name}?{c}}}")))
}

/// "Microsoft.WindowsCalculator" -> "Windows Calculator"
fn prettify(package_name: &str) -> String {
    let last = package_name.rsplit('.').next().unwrap_or(package_name);
    let mut out = String::new();
    let chars: Vec<char> = last.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if i > 0 && c.is_uppercase() && chars[i - 1].is_lowercase() {
            out.push(' ');
        }
        out.push(*c);
    }
    out
}

/// Manifest logos are stored with scale/size qualifiers in the file name.
fn find_logo(install: &Path, rel: &str) -> Option<String> {
    let full = install.join(rel);
    let dir = full.parent()?;
    let stem = full.file_stem()?.to_string_lossy().to_lowercase();
    let ext = full.extension()?.to_string_lossy().to_lowercase();
    let mut variants: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| {
            let l = n.to_lowercase();
            l.starts_with(&format!("{stem}.")) && l.ends_with(&format!(".{ext}"))
        })
        .filter(|n| !n.to_lowercase().contains("contrast"))
        .collect();
    variants.sort();
    let prefs = [
        "targetsize-48_altform-unplated",
        "targetsize-64_altform-unplated",
        "targetsize-48",
        "targetsize-64",
        "scale-200",
        "scale-150",
        "scale-100",
    ];
    let pick = prefs
        .iter()
        .find_map(|p| {
            variants
                .iter()
                .find(|v| v.to_lowercase().contains(&format!(".{p}.")))
        })
        .or_else(|| variants.first())?;
    Some(dir.join(pick).to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn list_store_apps() -> Vec<AppInfo> {
    let script = "ConvertTo-Json -Compress -InputObject @(Get-AppxPackage | Where-Object { \
        -not $_.IsFramework -and -not $_.IsResourcePackage -and -not $_.NonRemovable \
        -and $_.SignatureKind -ne 'System' } | Select-Object Name, PackageFullName, \
        PackageFamilyName, @{n='Version';e={$_.Version.ToString()}}, InstallLocation)";
    let Ok(json) = powershell(script) else {
        return Vec::new();
    };
    let raw: Vec<RawPackage> = serde_json::from_str(json.trim()).unwrap_or_default();

    let mut apps = Vec::new();
    for pkg in raw {
        let install = pkg.install_location.as_deref().and_then(clean_path);
        let manifest = install
            .as_ref()
            .and_then(|loc| std::fs::read_to_string(Path::new(loc).join("AppxManifest.xml")).ok())
            .unwrap_or_default();
        let props = manifest
            .find("<Properties>")
            .and_then(|s| {
                manifest[s..]
                    .find("</Properties>")
                    .map(|e| &manifest[s..s + e])
            })
            .unwrap_or("");

        let name = xml_tag(props, "DisplayName")
            .and_then(|v| resolve_resource(&v, &pkg.package_full_name, &pkg.name))
            .unwrap_or_else(|| prettify(&pkg.name));
        let publisher = xml_tag(props, "PublisherDisplayName")
            .and_then(|v| resolve_resource(&v, &pkg.package_full_name, &pkg.name));
        let icon_path = install.as_ref().and_then(|loc| {
            let rel = xml_attr(&manifest, "Square44x44Logo").or_else(|| xml_tag(props, "Logo"))?;
            find_logo(Path::new(loc), &rel)
        });

        apps.push(AppInfo {
            id: format!("store:{}", pkg.package_full_name),
            kind: "store".into(),
            name,
            publisher,
            version: pkg.version,
            install_location: install,
            icon_path,
            package_full_name: Some(pkg.package_full_name),
            package_family_name: Some(pkg.package_family_name),
            ..Default::default()
        });
    }
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}
