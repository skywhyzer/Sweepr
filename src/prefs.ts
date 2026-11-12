import { api } from "./api";

/** Per-user preferences kept in localStorage; reads never throw. */
export function getPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`pref:${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: boolean) {
  try {
    localStorage.setItem(`pref:${key}`, value ? "1" : "0");
  } catch {}
}

/**
 * Create a restore point before a risky change when the user wants that.
 * Failure (no admin rights, System Protection off) never blocks the change
 * itself; the caller decides whether to mention it.
 */
export async function safetyRestorePoint(description: string): Promise<boolean> {
  if (!getPref("autoRestore", true)) return true;
  try {
    await api.createRestorePoint(description);
    return true;
  } catch {
    return false;
  }
}
