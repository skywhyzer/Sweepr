<div align="center">

<img src="app-icon.png" width="96" alt="Sweepr logo" />

# Sweepr

**Fast, modern uninstaller for Windows — removes programs *and* everything they leave behind.**

English · [Русский](README.ru.md)

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)
![Built with](https://img.shields.io/badge/built%20with-Tauri%20%2B%20React-24C8DB)
![License](https://img.shields.io/badge/license-MIT-green)

<img src="docs/screenshots/main-dark.png" alt="Sweepr main window" width="820" />

</div>

## Features

- **One list for everything** — classic Win32 programs and Microsoft Store apps, with icons, publisher, version, size and install date.
- **Clean uninstall** — runs the program's own uninstaller first, then scans for leftover files, folders and registry entries.
- **Nothing is deleted blindly** — every leftover is shown with the reason it was found, and you confirm before anything is removed.
- **Force removal** — for broken or missing uninstallers: skips the uninstaller and removes all traces directly.
- **Registry backups** — a backup is made before registry cleanup, and you can restore it any time from the built-in backups manager.
- **Tweaks** — 19 reversible system tweaks (interface, privacy, gaming, updates). The previous value is saved before every change, so you can undo one tweak or all of them in a click, even after a restart; Sweepr also notices when Windows reverts a tweak.
- **Instant search, filters and sorting** — by name, size or date; `Ctrl+F` / `F3` focuses the search box.
- **Light and dark themes**, Material You inspired design.
- **English and Russian** interface.
- Small, native-feeling app powered by Tauri — no bundled browser.

## Screenshots

| 1. Confirm | 2. Leftovers found | 3. Done |
|---|---|---|
| <img src="docs/screenshots/confirm.png" width="280" /> | <img src="docs/screenshots/leftovers.png" width="280" /> | <img src="docs/screenshots/done.png" width="280" /> |

<p align="center"><img src="docs/screenshots/main-light.png" alt="Sweepr light theme" width="620" /></p>

## Installation

Download the latest `Sweepr_x.y.z_x64-setup.exe` from the [Releases](https://github.com/skywhyzer/Sweepr/releases) page and run it.

> Some programs can only be removed with administrator rights. Run Sweepr as administrator if an uninstall fails with an access error.

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
