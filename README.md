<div align="center">

<img src="app-icon.png" width="96" alt="Sweepr logo" />

# Sweepr

**A toolkit for Windows: removes programs *and* everything they leave behind, cleans the system, manages startup and helps fix the PC when something goes wrong.**

English · [Русский](README.ru.md)

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)
![Built with](https://img.shields.io/badge/built%20with-Tauri%20%2B%20React-24C8DB)
![License](https://img.shields.io/badge/license-MIT-green)

<img src="docs/screenshots/main-dark.png" alt="Sweepr main window" width="820" />

</div>

## What Sweepr does

A navigation pane on the left: **Programs · Startup · Clean-up · Disk · Tweaks · Recovery**, with **Settings** at the bottom.

### Programs

- One list for classic Win32 programs and Microsoft Store apps: icon, publisher, version, size, install date.
- **Clean uninstall.** The program's own uninstaller runs first, then Sweepr scans for leftover files, folders and registry entries. Every leftover is shown with the reason it was found and removed only after you confirm.
- **Force removal** for broken or missing uninstallers: skips the uninstaller and removes the traces directly.
- **Updates through winget.** If winget is installed, the list shows which programs have a newer version; update one program or all of them.
- **Works like File Explorer.** Details pane (version, size, location, uninstall command, registry key), context menu, full keyboard control: arrows, type-ahead, `Enter` / `Delete` to uninstall, `Ctrl+F` / `F3` to search.
- Instant search, filters and sorting by name, size or date.

### Startup

- Everything that runs with Windows in one list: Run keys, the Startup folder, sign-in scheduled tasks and third-party services, with publisher and command line.
- **Turning an item off never deletes it.** It uses the same flags as Task Manager, and services move to manual start. You can turn it back on any time.
- Entries whose program no longer exists are flagged and can be removed with a backup.

### Clean-up

- **Junk files.** Ten categories: temporary files, Windows Update and Delivery Optimization caches, crash dumps, error reports, shader cache, browser caches, Recycle Bin and more. The size of each category is shown before anything is removed. Only things Windows and programs recreate are touched.
- **Leftovers of removed programs.** Folders and registry keys that match no installed program, aren't used by startup entries or services and haven't changed for 30 days. Nothing is preselected; folders go to the Recycle Bin, keys to a registry backup.

### Disk

A WinDirStat-style usage analyzer: scan a drive or folder and see a folder tree with share bars, a colored treemap (with zoom) and statistics by file type. Largest files list, open or show in Explorer, move to the Recycle Bin or delete permanently right from the view.

### Tweaks

- 40 reversible settings in five groups: interface, privacy, gaming, updates and security.
- Examples: disable Windows Update, SmartScreen and UAC, remove shortcut arrows, dark mode, block telemetry and location, stop promoted app installs.
- The previous value is saved before every change. Undo one tweak or all of them in a click, even after a restart. If Windows reverts a setting, Sweepr notices.
- High-risk tweaks are marked red and ask for confirmation.
- Microsoft Defender can't be switched off through the registry because of Tamper Protection, so Sweepr explains how to do it in Windows Security instead of showing a toggle that does nothing.

### Recovery

- **Restore points:** list, create, turn System Protection on, open the System Restore wizard. Sweepr creates one automatically before uninstalling a program and before a high-risk tweak (on by default, can be turned off in Settings; needs administrator rights).
- **Registry backups.** A backup is made before every registry clean-up, and you can restore it any time.
- **Repair:** system file check (`sfc`), image repair (`DISM`), component store clean-up, network reset, Windows Update reset (folders are renamed, not deleted), DNS flush, icon cache rebuild, Explorer restart.

### Look and feel

Looks like part of Windows 11: Fluent design, Mica backdrop, your system accent colour, Segoe UI Variable. Light and dark themes (or follow Windows), English and Russian interface. A small app powered by Tauri, with no bundled browser.

## Screenshots

> The screenshots below were taken in earlier versions and will be refreshed.

| 1. Confirm | 2. Leftovers found | 3. Done |
|---|---|---|
| <img src="docs/screenshots/confirm.png" width="280" /> | <img src="docs/screenshots/leftovers.png" width="280" /> | <img src="docs/screenshots/done.png" width="280" /> |

<p align="center"><img src="docs/screenshots/main-light.png" alt="Sweepr light theme" width="620" /></p>

## Installation

Download the latest `Sweepr_x.y.z_x64-setup.exe` from the [Releases](https://github.com/skywhyzer/Sweepr/releases) page and run it.

> Some features need administrator rights: removing certain programs, system-level tweaks, restore points, repair. If something fails with an access error, run Sweepr as administrator.

## Build from source

Requirements: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) and the
[Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/skywhyzer/Sweepr.git
cd Sweepr
npm install

npm run tauri dev     # run in development mode
npm run tauri build   # build the installer (src-tauri/target/release/bundle/nsis)
```

## Tech stack

- **Frontend:** React 19, TypeScript, Vite
- **Backend:** Rust, Tauri 2
- **Installer:** NSIS (English / Russian)

## Roadmap

Ideas for future versions are tracked in [Issues](https://github.com/skywhyzer/Sweepr/issues). Suggestions and pull requests are welcome.

## License

[MIT](LICENSE)
