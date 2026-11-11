import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  BackupInfo,
  DeleteReport,
  DiskDeleteResult,
  DiskItem,
  Drive,
  ExtStat,
  Leftover,
  MapNode,
  ScanResult,
  TweakInfo,
} from "./types";

export const api = {
  isElevated: () => invoke<boolean>("is_elevated"),
  restartAsAdmin: () => invoke<void>("restart_as_admin"),
  listWin32: () => invoke<AppInfo[]>("list_win32_apps"),
  listStore: () => invoke<AppInfo[]>("list_store_apps"),
  getIcon: (path: string) => invoke<string | null>("get_icon", { path }),
  runUninstaller: (app: AppInfo) => invoke<number>("run_uninstaller", { app }),
  isInstalled: (app: AppInfo) => invoke<boolean>("is_installed", { app }),
  scanLeftovers: (app: AppInfo) => invoke<Leftover[]>("scan_leftovers", { app }),
  deleteLeftovers: (
    items: Leftover[],
    useTrash: boolean,
    backupRegistry: boolean,
    appName: string,
    session: string | null,
  ) =>
    invoke<DeleteReport>("delete_leftovers", {
      items,
      useTrash,
      backupRegistry,
      appName,
      session,
    }),
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  restoreBackup: (id: string) => invoke<number>("restore_backup", { id }),
  deleteBackup: (id: string) => invoke<void>("delete_backup", { id }),
  listTweaks: () => invoke<TweakInfo[]>("list_tweaks"),
  setTweak: (id: string, enabled: boolean) => invoke<TweakInfo>("set_tweak", { id, enabled }),
  resetTweaks: () => invoke<number>("reset_tweaks"),
  restartExplorer: () => invoke<void>("restart_explorer"),

  diskDrives: () => invoke<Drive[]>("disk_drives"),
  diskScan: (path: string) => invoke<ScanResult>("disk_scan", { path }),
  diskCancel: () => invoke<void>("disk_cancel"),
  diskClose: () => invoke<void>("disk_close"),
  diskItem: (id: number) => invoke<DiskItem | null>("disk_item", { id }),
  diskChildren: (id: number) => invoke<DiskItem[]>("disk_children", { id }),
  diskAncestry: (id: number) => invoke<DiskItem[]>("disk_ancestry", { id }),
  diskExtStats: (id: number) => invoke<ExtStat[]>("disk_ext_stats", { id }),
  diskTopFiles: (id: number, count: number) => invoke<DiskItem[]>("disk_top_files", { id, count }),
  diskTreemap: (id: number, depth: number, minFrac: number) =>
    invoke<MapNode | null>("disk_treemap", { id, depth, minFrac }),
  diskPath: (id: number) => invoke<string | null>("disk_path", { id }),
  diskReveal: (id: number) => invoke<void>("disk_reveal", { id }),
  diskOpen: (id: number) => invoke<void>("disk_open", { id }),
  diskDelete: (ids: number[], permanent: boolean) =>
    invoke<DiskDeleteResult>("disk_delete", { ids, permanent }),
};

const iconCache = new Map<string, Promise<string | null>>();

/** Icons are extracted once per path and shared between renders. */
export function loadIcon(path: string): Promise<string | null> {
  let p = iconCache.get(path);
  if (!p) {
    p = api.getIcon(path).catch(() => null);
    iconCache.set(path, p);
  }
  return p;
}
