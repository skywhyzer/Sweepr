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
  category: "interface" | "privacy" | "gaming" | "updates";
  risk: "low" | "medium";
  admin: boolean;
  explorer: boolean;
  relogin: boolean;
  enabled: boolean;
  /** Sweepr changed it and can restore the original value. */
  managed: boolean;
  /** Sweepr applied it, but something has since reverted it. */
  drift: boolean;
  applied?: number | null;
}
