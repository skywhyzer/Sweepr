# Changelog

## 0.5.0

### New icon and logo

- A new application icon (installer, window, taskbar) and a new logo for the README and the Settings page.

### Window scaling

- In a large window (maximised or full screen) the whole interface now scales up smoothly with the window, up to 175%, instead of staying tiny with empty space around it. Windows of the default size and smaller look as before.

### Loading placeholders

- Pages that load a list (Programs, Startup, Clean-up, Recovery, Tweaks, registry backups) show shimmering placeholder rows in the shape of the content instead of a lone spinner.

### Log, in the style of Windows Terminal

- One activity log for the whole app, shown as a terminal window (tab strip, Campbell colours, Cascadia Mono, blinking cursor). It records what Sweepr runs, what it finds, what it removes and where, and where backups go: uninstalling, restore points, clean-up, repair, startup, tweaks, disk, program updates and registry backups.
- It appears inside the uninstall dialog (follows the work live), in Recovery → Repair (command output with errors in red) and as a new **Log** page with filters and Copy / Clear. The last 600 entries survive a restart.

### Restore points

- Restore points can be deleted: one by one, a selection, or "keep only the latest". They are removed through Windows' own API, one at a time, so one failure doesn't stop the rest.
- Every point shows its type (install, uninstall, settings change…), a mark if Sweepr made it, the date, and the status line shows how much disk space the points take and where they live.
- The uninstall dialog has a checkbox **Create a restore point before uninstalling**, so it can be skipped for a single program. The default still comes from Settings.

### Disk

- Right-click on a tile of the map, on a row of the tree or on a file in the "Largest files" list opens a context menu: open, show in Explorer, zoom into the folder, copy the path, move to the Recycle Bin, delete permanently. The Menu key and Shift+F10 do the same in the tree.
- The treemap has a new look: rounded tiles with gutters between folders, a softer colour palette tuned separately for the dark and light themes, file names and sizes on large tiles and a clearer selection ring.

## 0.4.0

### New: startup, clean-up, recovery and program updates

Sweepr becomes a toolkit to keep on the PC for when something goes wrong. The navigation pane now reads: Programs · Startup · Clean-up · Disk · Tweaks · Recovery.

- **Startup** — one list of Run keys, Startup-folder shortcuts, sign-in/boot scheduled tasks and third-party automatic services, with publisher, description and command line, filters (enabled, disabled, broken) and search. Turning an item off never deletes it: Run keys and shortcuts use Task Manager's `StartupApproved` flags, tasks are disabled, services move to manual start with the original mode kept in a journal. Entries whose program no longer exists are flagged and can be removed (registry backup / Recycle Bin).
- **Clean-up → Junk files** — ten categories measured before anything is removed: temporary files (older than a day), Windows temp, Windows Update cache, Delivery Optimization, crash dumps, error reports, shader cache, browser caches (Chrome, Edge, Firefox, Yandex, Brave, Opera, Vivaldi), Recycle Bin; Windows.old is left to Windows' own Settings page. Links and junctions are never followed.
- **Clean-up → Leftovers of removed programs** — folders in Program Files, ProgramData and AppData and vendor keys in HKCU\Software that match no installed program, aren't used by any startup entry or service and haven't changed for 30 days. Nothing is preselected; deletion goes to the Recycle Bin with a registry backup.
- **Recovery** — restore points (list, create, turn System Protection on, open the System Restore wizard), registry backups (moved here from their own page), and repair actions: sfc, DISM RestoreHealth, component store clean-up, network reset, DNS flush, Windows Update reset (caches are renamed, not deleted), icon cache rebuild, Explorer restart.
- **Automatic restore point** before uninstalling a program and before a high-risk tweak (Settings → Safety; on by default, needs administrator rights).
- **Program updates** through winget: an "Updates" filter, the available version in the list and details pane, update one program or all.

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

### Many more tweaks

- The tweak catalogue grows from 19 to 40, in five groups (interface, privacy, gaming, updates, security).
- Popular additions: disable Windows Update (and driver / Store auto-updates), disable SmartScreen, disable UAC, remove shortcut arrows, Windows dark mode, turn off transparency, accent colour on title bars, show all tray icons, block location, stop promoted-app installs, disable Cortana, turn off online speech and typing data collection, no background apps, enable long file paths, and more.
- High-risk tweaks (disable updates, SmartScreen, UAC) are marked red and ask for confirmation; tweaks that need a full restart carry a badge.
- A search box filters the catalogue.
- Removing the shortcut arrow uses a transparent icon Sweepr generates, instead of a DLL icon index that varies between builds and often leaves a black square.
- Microsoft Defender is intentionally **not** offered as a toggle: on current Windows its registry switch is ignored by Tamper Protection, so the Security section explains how to turn it off in Windows Security instead of shipping a switch that does nothing.

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
