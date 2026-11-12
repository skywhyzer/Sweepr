# Changelog

## Unreleased

### Native Windows 11 look

The interface has moved from a Material/Google-style design to Fluent, so Sweepr looks like part of Windows rather than a web page:

- Mica backdrop behind the whole window on Windows 11, including the title bar (solid background on Windows 10).
- Your Windows accent colour is used for buttons, selection and switches.
- Segoe UI Variable instead of Roboto, Fluent System Icons instead of Material Symbols.
- WinUI-style controls: buttons, text box, combo box, check boxes, toggle switches, segmented control, menus and dialogs with a footer button bar; programs are listed as cards, as in Windows Settings.
- Thin Fluent scroll bars; arrow cursor instead of the hand cursor.
- Browser behaviour is switched off: the WebView context menu, F5 / Ctrl+R reload, Ctrl+P print, the find bar, back/forward navigation and dragging images out.
- The window appears only after the first paint, so there is no white flash at startup.

### Navigation pane and details pane

- A left navigation pane (as in WinUI's NavigationView) replaces the toolbar icons: **Programs**, **Disk**, **Tweaks**, **Backups**, and **Settings** at the bottom. It can be collapsed to icons and collapses by itself in narrow windows.
- Tweaks and registry backups are full pages instead of dialogs, laid out as Windows Settings cards.
- New **Settings** page: theme (light, dark or follow Windows), language, administrator rights, version.
- The program list works like File Explorer: click to select, a details pane on the right (type, version, size, install date, location, uninstall command, registry key, package name — each can be copied) with **Uninstall** and **Force remove** buttons and **Open file location**.
- Right-click menu on programs: uninstall, force remove, open file location, copy name.
- Keyboard: arrows, Page Up/Down, Home/End, type-ahead by name, `Enter` / `Delete` to uninstall, `Shift+F10` / Menu key for the context menu, `↓` from the search box into the list.
- The default window is larger (1180 × 760) to fit the details pane.

## 0.3.0

### New: reversible system tweaks

The **Tweaks** button (sliders icon) opens 19 switches for Windows settings: interface, privacy, gaming and input, updates.

- The previous value of every setting is saved before it is changed, so a tweak can be undone exactly, even after a restart.
- **Undo all my changes** restores everything Sweepr has changed.
- If Windows reverts a tweak later, Sweepr shows it and offers **Apply again**.
- Tweaks that write to HKLM are locked without administrator rights; hints say when Explorer must be restarted or you need to sign in again.

## 0.2.0

### New: disk usage analyzer

A new **Disk** view (switch at the top of the window) shows what takes up space, in the spirit of WinDirStat:

- Pick a drive (with free/used space at a glance) or any folder and scan it — fast, multi-threaded, can be stopped at any time.
- **Folder tree** sorted by size with share bars, size, file count and modification date; keyboard navigation (arrows, Enter to open, Del / Shift+Del to delete).
- **Treemap** of the whole scan: every file is a block colored by its type, with cushion shading. Hover for details, click to select, double-click to zoom into a folder, breadcrumbs to zoom back out.
- **File types** — size, count and share of each extension; click one to highlight it on the map.
- **Largest files** list.
- Actions on the selection: open, show in Explorer, copy path, move to the Recycle Bin or delete permanently. System folders are protected.
- Junctions and symbolic links are not followed, so nothing is counted twice.

### Fixes

- The logo icon no longer disappears when the window is narrow.

## 0.1.0

First public release.
