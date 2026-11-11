# Changelog

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
