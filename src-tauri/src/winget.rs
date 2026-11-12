//! Program updates through winget (App Installer), when it is present.
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
}
