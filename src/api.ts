import { invoke } from "@tauri-apps/api/core";
import type { AppInfo, BackupInfo, DeleteReport, Leftover } from "./types";

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
