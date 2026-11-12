export interface AppInfo {
  id: string;
  kind: "win32" | "store";
  name: string;
  publisher?: string | null;
  version?: string | null;
  installLocation?: string | null;
  uninstallString?: string | null;
  quietUninstallString?: string | null;
  iconPath?: string | null;
  sizeBytes?: number | null;
  installDate?: string | null;
  registryKey?: string | null;
  isMsi?: boolean;
  productCode?: string | null;
  packageFullName?: string | null;
  packageFamilyName?: string | null;
}

export interface Leftover {
  kind: "dir" | "file" | "regkey" | "regvalue";
  path: string;
  valueName?: string | null;
  sizeBytes: number;
  confidence: "safe" | "review";
  reason: string;
}

export interface DeleteReport {
  deleted: number;
  freedBytes: number;
  failed: { path: string; error: string }[];
  backupPath: string | null;
  session: string | null;
  deletedItems: Leftover[];
}

export interface BackupInfo {
  id: string;
  appName: string;
  /** Unix time, seconds */
  created: number;
  entries: string[];
}

export interface TweakInfo {
  id: string;
  category: "interface" | "privacy" | "gaming" | "updates" | "security";
  risk: "low" | "medium" | "high";
  admin: boolean;
  explorer: boolean;
  relogin: boolean;
  reboot: boolean;
  enabled: boolean;
  /** Sweepr changed it and can restore the original value. */
  managed: boolean;
  /** Sweepr applied it, but something has since reverted it. */
  drift: boolean;
  applied?: number | null;
}

export interface Drive {
  path: string;
  label: string;
  kind: "fixed" | "removable" | "network" | "cdrom" | "ram";
  total: number;
  free: number;
}

/** 0 = folder, 1 = file, 2 = small files folded together */
export type DiskKind = 0 | 1 | 2;

export interface DiskItem {
  id: number;
  name: string;
  size: number;
  files: number;
  kind: DiskKind;
  ext: string;
  /** Unix time, seconds */
  modified: number;
  hasChildren: boolean;
}

export interface ExtStat {
  ext: string;
  count: number;
  bytes: number;
}

/** Treemap node: id, name, size, kind, extension, children. */
export interface MapNode {
  id: number;
  n: string;
  s: number;
  k: DiskKind;
  e: string;
  c?: MapNode[];
}

export interface ScanResult {
  root: DiskItem;
  path: string;
  errors: number;
  cancelled: boolean;
  seconds: number;
  free: number | null;
  total: number | null;
}

export interface ScanProgress {
  files: number;
  dirs: number;
  bytes: number;
  current: string;
}

export interface DiskDeleteResult {
  deleted: number;
  freed: number;
  failed: { path: string; error: string }[];
}

export interface StartupItem {
  id: string;
  source: "run" | "folder" | "task" | "service";
  name: string;
  command: string;
  path: string | null;
  publisher: string | null;
  description: string | null;
  location: string;
  enabled: boolean;
  needsAdmin: boolean;
  missing: boolean;
}

export interface CleanCategory {
  id: string;
  sizeBytes: number;
  files: number;
  needsAdmin: boolean;
  partial: boolean;
  manual: boolean;
  paths: string[];
}

export interface CleanResult {
  id: string;
  freedBytes: number;
  skipped: number;
}

export interface Orphan {
  kind: "dir" | "regkey";
  path: string;
  name: string;
  root: "programFiles" | "programData" | "appData" | "localAppData" | "registry";
  sizeBytes: number;
  modified: number;
}

export interface RestorePoint {
  sequence: number;
  description: string;
  created: number;
  /** Windows' RestorePointType: 0 install, 1 uninstall, 10 driver, 12 settings. */
  kind: number;
}

export interface RestoreStatus {
  enabled: boolean;
  points: RestorePoint[];
  usedBytes?: number | null;
  maxBytes?: number | null;
}

export interface RestoreRemoveResult {
  deleted: number[];
  failed: { sequence: number; error: string }[];
}

export interface RepairResult {
  ok: boolean;
  output: string;
  reboot: boolean;
}

export interface WingetUpdate {
  name: string;
  id: string;
  version: string;
  available: string;
}
