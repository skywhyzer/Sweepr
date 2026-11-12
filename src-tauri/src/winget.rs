//! Program updates and "what is this program" lookups through winget (App
//! Installer), when it is present.
//!
//! `winget upgrade` prints a table whose headers are translated, so columns are
//! found by position: the header line sits right above a line of dashes, and
//! each column starts where a header word starts.

use std::process::Command;

use serde::Serialize;

use crate::util::run_console;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WingetUpdate {
    name: String,
    id: String,
    version: String,
    available: String,
}

fn winget() -> Command {
    let mut cmd = Command::new("winget");
    cmd.env("NO_COLOR", "1");
    cmd
}

/// Column start positions (in chars) from a header line.
fn column_starts(header: &[char]) -> Vec<usize> {
    let mut starts = Vec::new();
    for (i, c) in header.iter().enumerate() {
        if !c.is_whitespace() && (i == 0 || header[i - 1].is_whitespace()) {
            starts.push(i);
        }
    }
    starts
}

fn parse_table(text: &str) -> Vec<WingetUpdate> {
    let lines: Vec<&str> = text.lines().collect();
    let Some(dash) = lines
        .iter()
        .position(|l| l.trim().len() > 10 && l.trim().chars().all(|c| c == '-'))
    else {
        return Vec::new();
    };
    if dash == 0 {
        return Vec::new();
    }
    let header: Vec<char> = lines[dash - 1].chars().collect();
    let starts = column_starts(&header);
    if starts.len() < 4 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for line in &lines[dash + 1..] {
        let chars: Vec<char> = line.chars().collect();
        // The table ends at a summary line ("3 upgrades available.") or a blank.
        if chars.len() < starts[3] {
            break;
        }
        let field = |i: usize| -> String {
            let from = starts[i].min(chars.len());
            let to = starts.get(i + 1).copied().unwrap_or(chars.len()).min(chars.len());
            chars[from..to].iter().collect::<String>().trim().to_string()
        };
        let u = WingetUpdate { name: field(0), id: field(1), version: field(2), available: field(3) };
        if u.id.is_empty() || u.id.contains(' ') || u.available.is_empty() {
            continue;
        }
        out.push(u);
    }
    out
}

/// Programs with a newer version available. `Err("missing")` when winget is
/// not installed.
#[tauri::command(async)]
pub fn winget_updates() -> Result<Vec<WingetUpdate>, String> {
    let mut cmd = winget();
    cmd.args(["upgrade", "--accept-source-agreements", "--disable-interactivity"]);
    let (_, text) = run_console(&mut cmd).map_err(|_| "missing".to_string())?;
    Ok(parse_table(&text))
}

#[tauri::command(async)]
pub fn winget_upgrade(id: String) -> Result<String, String> {
    if id.is_empty() || id.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("bad package id".into());
    }
    let mut cmd = winget();
    cmd.args([
        "upgrade",
        "--id",
        &id,
        "--exact",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity",
    ]);
    let (ok, text) = run_console(&mut cmd)?;
    let last: Vec<&str> = text.lines().rev().take(6).collect();
    let summary = last.into_iter().rev().collect::<Vec<_>>().join("\n");
    if ok {
        Ok(summary)
    } else {
        Err(summary)
    }
}


// ------------------------------------------------------------ about a program

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InfoField {
    label: String,
    value: String,
}

/// What the winget catalogue knows about a program.
#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WingetInfo {
    id: String,
    /// Catalogue it came from ("winget", "msstore").
    source: String,
    description: Option<String>,
    homepage: Option<String>,
    tags: Vec<String>,
    /// Everything else worth showing, labelled the way winget prints it
    /// (so the labels follow the system language).
    fields: Vec<InfoField>,
}

/// "Git version 2.47.1", "Python 3.13.1 (64-bit)", "Foo (x64) 1.2" -> the
/// name without version and architecture, to search the catalogue by.
fn search_name(name: &str) -> String {
    let mut s = name.split(" (").next().unwrap_or(name).trim().to_string();
    while let Some((head, tail)) = s.rsplit_once(' ') {
        let bare = tail.trim_start_matches(['v', 'V']);
        let versionish = bare.chars().any(|c| c.is_ascii_digit())
            && bare.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-');
        let noise = matches!(tail.to_lowercase().as_str(), "version" | "x64" | "x86" | "user");
        if (versionish || noise) && !head.trim().is_empty() {
            s = head.trim().to_string();
        } else {
            break;
        }
    }
    s
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

struct Found {
    name: String,
    id: String,
    source: String,
}

/// Rows of `winget search`: name, id and the last column (the source).
fn parse_search(text: &str) -> Vec<Found> {
    let lines: Vec<&str> = text.lines().collect();
    let Some(dash) = lines
        .iter()
        .position(|l| l.trim().len() > 10 && l.trim().chars().all(|c| c == '-'))
    else {
        return Vec::new();
    };
    if dash == 0 {
        return Vec::new();
    }
    let header: Vec<char> = lines[dash - 1].chars().collect();
    let starts = column_starts(&header);
    if starts.len() < 3 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for line in &lines[dash + 1..] {
        let chars: Vec<char> = line.chars().collect();
        if chars.len() < starts[1] {
            break;
        }
        let field = |i: usize| -> String {
            let from = starts[i].min(chars.len());
            let to = starts.get(i + 1).copied().unwrap_or(chars.len()).min(chars.len());
            chars[from..to].iter().collect::<String>().trim().to_string()
        };
        let id = field(1);
        if id.is_empty() || id.contains(' ') {
            continue;
        }
        out.push(Found { name: field(0), id, source: field(starts.len() - 1) });
    }
    out
}

/// The catalogue entry that is most likely this program: same name first,
/// then a name that contains it; the main catalogue before the Store.
fn best_match(found: &[Found], query: &str) -> Option<usize> {
    let q = norm(query);
    if q.len() < 2 {
        return None;
    }
    let rank = |f: &Found| -> Option<u8> {
        let n = norm(&f.name);
        let base = if n == q {
            0
        } else if q.len() >= 4 && n.contains(&q) {
            2
        } else {
            return None;
        };
        Some(base + u8::from(f.source.to_lowercase() == "msstore"))
    };
    found
        .iter()
        .enumerate()
        .filter_map(|(i, f)| rank(f).map(|r| (r, i)))
        .min()
        .map(|(_, i)| i)
}

fn is_installer_section(key: &str) -> bool {
    let k = key.to_lowercase();
    k.starts_with("installer") || k.starts_with("установщик")
}

/// `winget show` prints `Key: value` lines, with indented continuation lines
/// for long text and lists. The installer block at the end is not interesting.
fn parse_show(text: &str) -> WingetInfo {
    let mut raw: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(last) = raw.last_mut() {
                if !last.1.is_empty() {
                    last.1.push('\n');
                }
                last.1.push_str(line.trim());
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let key = key.trim();
        // "Found Mozilla Firefox [Mozilla.Firefox]" is the title line.
        if key.contains('[') || key.is_empty() {
            continue;
        }
        if is_installer_section(key) {
            break;
        }
        raw.push((key.to_string(), value.trim().to_string()));
    }

    let mut info = WingetInfo { source: "winget".into(), ..Default::default() };
    let mut short: Option<String> = None;
    for (key, value) in raw {
        if value.is_empty() {
            continue;
        }
        let k = key.to_lowercase();
        match k.as_str() {
            "description" | "описание" => info.description = Some(value.replace('\n', " ")),
            "short description" | "краткое описание" => short = Some(value.replace('\n', " ")),
            "homepage" | "домашняя страница" => info.homepage = Some(value),
            "tags" | "теги" => {
                info.tags = value
                    .split(['\n', ','])
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .take(12)
                    .collect()
            }
            // Shown elsewhere in the pane, or long legal text nobody reads here.
            "version" | "версия" | "moniker" | "псевдоним" | "copyright" | "авторские права"
            | "agreements" | "соглашения" | "release notes" | "заметки о выпуске"
            | "privacy url" => {}
            _ => {
                // Store links open only inside the Store; skip them.
                if value.starts_with("ms-windows-store:") || info.fields.len() >= 8 {
                    continue;
                }
                let mut v = value.replace('\n', ", ");
                if v.chars().count() > 160 {
                    v = v.chars().take(157).collect::<String>() + "…";
                }
                info.fields.push(InfoField { label: key, value: v });
            }
        }
    }
    if info.description.is_none() {
        info.description = short;
    }
    // No homepage: the publisher's site will do. Never show the same link twice.
    if info.homepage.is_none() {
        if let Some(i) = info.fields.iter().position(|f| {
            let l = f.label.to_lowercase();
            (l == "publisher url" || l == "url издателя") && f.value.starts_with("http")
        }) {
            info.homepage = Some(info.fields.remove(i).value);
        }
    }
    if let Some(h) = info.homepage.clone() {
        info.fields.retain(|f| f.value != h);
    }
    info
}

fn plain_arg(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 120
        && !s.starts_with('-')
        && !s.chars().any(|c| c.is_control() || c == '"')
}

/// What the winget catalogue says about a program: where it comes from, who
/// makes it, its site, licence and description. Only the program's name (or
/// its package id) is sent. `Ok(None)` when nothing matches, `Err("missing")`
/// when winget is not installed.
#[tauri::command(async)]
pub fn winget_info(name: String, id: Option<String>) -> Result<Option<WingetInfo>, String> {
    let (id, source) = match id.filter(|i| plain_arg(i) && !i.contains(' ')) {
        Some(id) => (id, "winget".to_string()),
        None => {
            let query = search_name(&name);
            if !plain_arg(&query) {
                return Ok(None);
            }
            let mut cmd = winget();
            cmd.args([
                "search",
                "--name",
                &query,
                "--accept-source-agreements",
                "--disable-interactivity",
            ]);
            let (_, text) = run_console(&mut cmd).map_err(|_| "missing".to_string())?;
            let found = parse_search(&text);
            let Some(i) = best_match(&found, &query) else { return Ok(None) };
            let f = &found[i];
            (f.id.clone(), if f.source.is_empty() { "winget".into() } else { f.source.clone() })
        }
    };

    let mut cmd = winget();
    cmd.args(["show", "--id", &id, "--exact", "--accept-source-agreements", "--disable-interactivity"]);
    let (ok, text) = run_console(&mut cmd).map_err(|_| "missing".to_string())?;
    if !ok {
        return Ok(None);
    }
    let mut info = parse_show(&text);
    info.id = id;
    info.source = source;
    Ok(Some(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_localized_table() {
        let text = "Имя                    ИД                     Версия    Доступно  Источник\n\
                    ---------------------------------------------------------------------------\n\
                    Mozilla Firefox (x64)  Mozilla.Firefox        144.0     145.0     winget\n\
                    7-Zip 24.08 (x64)      7zip.7zip              24.08     25.01     winget\n\
                    2 обновления доступны.";
        let u = parse_table(text);
        assert_eq!(u.len(), 2);
        assert_eq!(u[0].id, "Mozilla.Firefox");
        assert_eq!(u[0].available, "145.0");
        assert_eq!(u[1].name, "7-Zip 24.08 (x64)");
    }

    /// Asks the real winget; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn live_info() {
        for name in ["Git", "Mozilla Firefox (x64 ru)", "7-Zip 24.08 (x64)", "Telegram Desktop", "Some Program That Does Not Exist 123"] {
            let info = winget_info(name.to_string(), None).expect("winget");
            println!("{name} => {info:#?}");
        }
    }

    #[test]
    fn strips_versions_from_names() {
        assert_eq!(search_name("Git version 2.47.1"), "Git");
        assert_eq!(search_name("Python 3.13.1 (64-bit)"), "Python");
        assert_eq!(search_name("Mozilla Firefox (x64 ru)"), "Mozilla Firefox");
        assert_eq!(search_name("7-Zip 24.08 (x64)"), "7-Zip");
        assert_eq!(search_name("Visual Studio Code (User)"), "Visual Studio Code");
    }

    #[test]
    fn picks_the_matching_catalogue_entry() {
        let text = "Имя                 ИД                    Версия   Источник\n\
                    ------------------------------------------------------------\n\
                    Git Extras          Foo.GitExtras         1.0      winget\n\
                    Git                 Git.Git               2.47.1   winget\n\
                    Git                 9NABC123              2.47.1   msstore";
        let found = parse_search(text);
        assert_eq!(found.len(), 3);
        let i = best_match(&found, "Git").unwrap();
        assert_eq!(found[i].id, "Git.Git");
        assert!(best_match(&found, "Totally Different").is_none());
    }

    #[test]
    fn parses_localized_show() {
        let text = "Найдено Mozilla Firefox [Mozilla.Firefox]\n\
                    Версия: 144.0\n\
                    Издатель: Mozilla\n\
                    Домашняя страница: https://www.mozilla.org/firefox/\n\
                    Лицензия: MPL-2.0\n\
                    Описание:\n\
                    \x20 Быстрый браузер.\n\
                    \x20 Работает везде.\n\
                    Теги:\n\
                    \x20 browser\n\
                    \x20 web\n\
                    Установщик:\n\
                    \x20 Тип: msi";
        let i = parse_show(text);
        assert_eq!(i.homepage.as_deref(), Some("https://www.mozilla.org/firefox/"));
        assert_eq!(i.description.as_deref(), Some("Быстрый браузер. Работает везде."));
        assert_eq!(i.tags, vec!["browser", "web"]);
        assert_eq!(i.fields.len(), 2);
        assert_eq!(i.fields[0].label, "Издатель");
    }
}
