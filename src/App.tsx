import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { I18n, initialLang, makeT, type Key, type Lang } from "./i18n";
import type { AppInfo } from "./types";
import { Icon } from "./ui";
import AppsPage from "./AppsPage";
import UninstallDialog from "./UninstallDialog";
import BackupsPage from "./BackupsPage";
import TweaksPage from "./TweaksPage";
import SettingsPage, { type ThemePref } from "./SettingsPage";
import DiskView from "./DiskView";

type View = "apps" | "disk" | "tweaks" | "backups" | "settings";
const VIEWS: View[] = ["apps", "disk", "tweaks", "backups", "settings"];

const NAV: [View, string, Key][] = [
  ["apps", "apps", "viewApps"],
  ["disk", "donut_large", "viewDisk"],
  ["tweaks", "tune", "tweaks"],
  ["backups", "history", "navBackups"],
];

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [themePref, setThemePref] = useState<ThemePref>(() =>
    stored("theme", ["light", "dark", "system"] as const, "system"),
  );
  const [systemDark, setSystemDark] = useState(darkQuery.matches);
  const theme = themePref === "system" ? (systemDark ? "dark" : "light") : themePref;
  const t = useMemo(() => makeT(lang), [lang]);

  const [win32, setWin32] = useState<AppInfo[] | null>(null);
  const [store, setStore] = useState<AppInfo[] | null>(null);
  const [elevated, setElevated] = useState(true);
  const [target, setTarget] = useState<{ app: AppInfo; force: boolean } | null>(null);
  const [view, setView] = useState<View>(() => stored("view", VIEWS, "apps"));
  const [navCollapsed, setNavCollapsed] = useState(
    () => stored("nav", ["open", "collapsed"] as const, "open") === "collapsed",
  );

  const reload = useCallback(() => {
    api
      .listWin32()
      .then(setWin32)
      .catch(() => setWin32([]));
    api
      .listStore()
      .then(setStore)
      .catch(() => setStore([]));
  }, []);

  useEffect(() => {
    reload();
    api
      .isElevated()
      .then(setElevated)
      .catch(() => {});
  }, [reload]);

  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    getCurrentWindow()
      .setTheme(theme)
      .catch(() => {});
  }, [theme]);

  useEffect(() => save("theme", themePref), [themePref]);
  useEffect(() => save("view", view), [view]);
  useEffect(() => save("nav", navCollapsed ? "collapsed" : "open"), [navCollapsed]);

  useEffect(() => {
    document.documentElement.lang = lang;
    save("lang", lang);
  }, [lang]);

  const forceByFolder = async () => {
    const dir = await pickFolder({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    const name =
      dir
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop() || dir;
    setTarget({
      app: { id: `folder:${dir}`, kind: "win32", name, installLocation: dir },
      force: true,
    });
  };

  const restartAdmin = () => api.restartAsAdmin().catch(() => {});

  const navItem = (id: View, icon: string, label: Key) => (
    <button
      key={id}
      className={`nav-item ${view === id ? "on" : ""}`}
      aria-current={view === id ? "page" : undefined}
      title={navCollapsed ? t(label) : undefined}
      onClick={() => setView(id)}
    >
      <Icon name={icon} />
      <span className="nav-label">{t(label)}</span>
    </button>
  );

  return (
    <I18n.Provider value={{ lang, t }}>
      <div className={`shell ${navCollapsed ? "nav-collapsed" : ""}`}>
        <nav className="nav">
          <button
            className="nav-item nav-toggle"
            title={t("navToggle")}
            aria-expanded={!navCollapsed}
            onClick={() => setNavCollapsed((c) => !c)}
          >
            <Icon name="menu" />
          </button>
          {NAV.map(([id, icon, label]) => navItem(id, icon, label))}
          <div className="spacer" />
          {navItem("settings", "settings", "settings")}
        </nav>

        <main className="content">
          <div className={view === "apps" ? "view-host" : "hidden"}>
            <AppsPage
              active={view === "apps" && !target}
              elevated={elevated}
              win32={win32}
              store={store}
              reload={reload}
              onUninstall={(app, force) => setTarget({ app, force })}
              onForceFolder={forceByFolder}
              onRestartAdmin={restartAdmin}
            />
          </div>
          {/* The disk view stays mounted so a finished scan survives switching pages. */}
          <div className={view === "disk" ? "view-host" : "hidden"}>
            <DiskView dark={theme === "dark"} />
          </div>
          {view === "tweaks" && <TweaksPage elevated={elevated} />}
          {view === "backups" && <BackupsPage />}
          {view === "settings" && (
            <SettingsPage
              themePref={themePref}
              setThemePref={setThemePref}
              setLang={setLang}
              elevated={elevated}
              onRestartAdmin={restartAdmin}
            />
          )}
        </main>
      </div>

      {target && (
        <UninstallDialog
          app={target.app}
          force={target.force}
          onClose={(changed) => {
            setTarget(null);
            if (changed) reload();
          }}
        />
      )}
    </I18n.Provider>
  );
}
