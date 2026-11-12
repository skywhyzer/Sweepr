import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  BackupInfo,
  DeleteReport,
  DiskDeleteResult,
  DiskItem,
  DriverInfo,
  DriverInstallResult,
  DriverUpdate,
  Drive,
  ExtStat,
  Leftover,
  MapNode,
  Orphan,
  RepairResult,
  RestoreRemoveResult,
  RestoreStatus,
  ScanResult,
  StartupItem,
  TweakInfo,
  WingetInfo,
  WingetUpdate,
  CleanCategory,
  CleanResult,
} from "./types";

export const api = {
  isElevated: () => invoke<boolean>("is_elevated"),
  restartAsAdmin: () => invoke<void>("restart_as_admin"),
  openLocation: (path: string) => invoke<void>("open_location", { path }),

  listStartup: () => invoke<StartupItem[]>("list_startup"),
  setStartup: (id: string, enabled: boolean) => invoke<void>("set_startup", { id, enabled }),
  removeStartup: (id: string, name: string) => invoke<void>("remove_startup", { id, name }),

  scanCleanup: () => invoke<CleanCategory[]>("scan_cleanup"),
  runCleanup: (ids: string[]) => invoke<CleanResult[]>("run_cleanup", { ids }),
  openStorageSettings: () => invoke<void>("open_storage_settings"),
  scanOrphans: () => invoke<Orphan[]>("scan_orphans"),

  restoreStatus: () => invoke<RestoreStatus>("restore_status"),
  createRestorePoint: (description: string) =>
    invoke<void>("create_restore_point", { description }),
  deleteRestorePoints: (sequences: number[]) =>
    invoke<RestoreRemoveResult>("delete_restore_points", { sequences }),
  enableSystemProtection: () => invoke<void>("enable_system_protection"),
  openSystemRestore: () => invoke<void>("open_system_restore"),
  runRepair: (id: string) => invoke<RepairResult>("run_repair", { id }),

  wingetUpdates: () => invoke<WingetUpdate[]>("winget_updates"),
  listDrivers: () => invoke<DriverInfo[]>("list_drivers"),
  scanDriverUpdates: () => invoke<DriverUpdate[]>("scan_driver_updates"),
  installDriverUpdates: (ids: string[]) =>
    invoke<DriverInstallResult>("install_driver_updates", { ids }),
  exportDrivers: () => invoke<{ folder: string; output: string }>("export_drivers"),
  openDeviceManager: () => invoke<void>("open_device_manager"),
  wingetInfo: (name: string, id?: string) =>
    invoke<WingetInfo | null>("winget_info", { name, id: id ?? null }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  wingetUpgrade: (id: string) => invoke<string>("winget_upgrade", { id }),
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
