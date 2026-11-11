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
