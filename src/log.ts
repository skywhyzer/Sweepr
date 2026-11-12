import { useSyncExternalStore } from "react";

/**
 * One activity log for the whole app. Every section writes to it (what it
 * runs, what it finds, what it changes and where), and the terminal views
 * (`LogView`) read from it: a panel inside a dialog, a block on a page, and
 * the full "Log" page. The last entries survive a restart.
 */

export type LogLevel = "info" | "ok" | "warn" | "err" | "cmd" | "out";

export type LogScope =
  | "uninstall"
  | "restore"
  | "cleanup"
  | "repair"
  | "startup"
  | "tweaks"
  | "disk"
  | "updates"
  | "backups"
  | "drivers"
  | "system";

export interface LogEntry {
  id: number;
  /** Milliseconds since the epoch; 0 for lines that have no time (command output). */
  time: number;
  level: LogLevel;
  scope: LogScope;
  text: string;
}

const STORE_KEY = "log:v1";
const MAX_ENTRIES = 600;

function load(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as LogEntry[]) : [];
    return Array.isArray(list) ? list.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

let entries: LogEntry[] = load();
let nextId = entries.length ? entries[entries.length - 1].id + 1 : 1;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    } catch {}
  }, 400);
  listeners.forEach((l) => l());
}

function add(level: LogLevel, scope: LogScope, text: string) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const fresh: LogEntry[] = [];
  const time = Date.now();
  for (const line of lines) {
    if (!line.trim()) continue;
    fresh.push({ id: nextId++, time: level === "out" ? 0 : time, level, scope, text: line });
  }
  if (!fresh.length) return;
  entries = entries.concat(fresh).slice(-MAX_ENTRIES);
  changed();
}

export const log = {
  info: (scope: LogScope, text: string) => add("info", scope, text),
  ok: (scope: LogScope, text: string) => add("ok", scope, text),
  warn: (scope: LogScope, text: string) => add("warn", scope, text),
  err: (scope: LogScope, text: string) => add("err", scope, text),
  /** A command or action Sweepr is about to run. */
  cmd: (scope: LogScope, text: string) => add("cmd", scope, text),
  /** Raw output of a command, line by line, without time stamps. */
  out: (scope: LogScope, text: string) => add("out", scope, text),
  /** Id the next entry will get; entries from `since` on belong to a run. */
  mark: () => nextId,
  clear: () => {
    entries = [];
    changed();
  },
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** All entries; a new array whenever something is logged. */
export function useLog(): LogEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function entriesToText(list: LogEntry[]): string {
  return list
    .map((e) => `${e.time ? formatTime(e.time) : "        "}  ${e.scope.padEnd(9)} ${e.text}`)
    .join("\n");
}

/** Turns raw command output into entries, colouring lines that look like errors. */
export function linesToEntries(text: string, scope: LogScope = "repair"): LogEntry[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim())
    .map((line, i) => {
      let level: LogLevel = "out";
      if (/\b(error|failed|failure|denied)\b|ошибк|не удалось|отказано/i.test(line)) level = "err";
      else if (/\bwarn(ing)?\b|предупрежд/i.test(line)) level = "warn";
      else if (/successfully|completed|operation completed|успешно|завершен|не обнаружено/i.test(line))
        level = "ok";
      return { id: i, time: 0, level, scope, text: line };
    });
}
