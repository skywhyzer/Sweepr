import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { I18n, formatDate, formatSize, initialLang, makeT, type Lang } from "./i18n";
import type { AppInfo } from "./types";
import { AppIcon, Icon, Spinner } from "./ui";
import UninstallDialog from "./UninstallDialog";
import BackupsDialog from "./BackupsDialog";
import DiskView from "./DiskView";

type Filter = "all" | "win32" | "store";
type Sort = "name" | "size" | "date";
type Theme = "light" | "dark";
type View = "apps" | "disk";

export default function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) ?? "light",
  );
  const t = useMemo(() => makeT(lang), [lang]);

  const [win32, setWin32] = useState<AppInfo[] | null>(null);
  const [store, setStore] = useState<AppInfo[] | null>(null);
  const [elevated, setElevated] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [target, setTarget] = useState<{ app: AppInfo; force: boolean } | null>(null);
  const [showBackups, setShowBackups] = useState(false);
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem("view") === "disk" ? "disk" : "apps";
    } catch {
      return "apps";
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);

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
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    getCurrentWindow()
      .setTheme(theme)
      .catch(() => {});
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("view", view);
    } catch {}
  }, [view]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("lang", lang);
    } catch {}
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        document.documentElement.dataset.view !== "disk" &&
        ((e.ctrlKey && e.key.toLowerCase() === "f") || e.key === "F3")
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setMenuFor(null);
    };
    const onClick = () => setMenuFor(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, []);

  const visible = useMemo(() => {
    let list: AppInfo[] = [];
    if (filter !== "store") list = list.concat(win32 ?? []);
    if (filter !== "win32") list = list.concat(store ?? []);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) => a.name.toLowerCase().includes(q) || a.publisher?.toLowerCase().includes(q),
      );
    }
    const byName = (a: AppInfo, b: AppInfo) => a.name.localeCompare(b.name, lang);
    return [...list].sort((a, b) => {
      if (sort === "size") return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || byName(a, b);
      if (sort === "date")
        return (b.installDate ?? "").localeCompare(a.installDate ?? "") || byName(a, b);
      return byName(a, b);
    });
  }, [win32, store, filter, query, sort, lang]);

  const totalSize = useMemo(
    () => visible.reduce((sum, a) => sum + (a.sizeBytes ?? 0), 0),
    [visible],
  );
  const loading = win32 === null;

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

  document.documentElement.dataset.view = view;

  const chips: [Filter, string][] = [
    ["all", t("all")],
    ["win32", t("programs")],
    ["store", t("store")],
  ];

  return (
    <I18n.Provider value={{ lang, t }}>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="logo">
              <Icon name="delete_sweep" />
            </div>
            <span>Sweepr</span>
          </div>
          <div className="seg views">
            <button className={view === "apps" ? "on" : ""} onClick={() => setView("apps")}>
              <Icon name="apps" />
              {t("viewApps")}
            </button>
            <button className={view === "disk" ? "on" : ""} onClick={() => setView("disk")}>
              <Icon name="donut_large" />
              {t("viewDisk")}
            </button>
          </div>
          {view === "disk" ? (
            <div className="spacer" />
          ) : (
            <label className="search">
              <Icon name="search" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search")}
                spellCheck={false}
              />
              {query && (
                <button
                  className="icon-btn small"
                  onClick={() => setQuery("")}
                  aria-label={t("close")}
                >
                  <Icon name="close" />
                </button>
              )}
            </label>
          )}
          <div className="actions">
            {view === "apps" && (
              <>
                <button className="icon-btn" title={t("forceFolder")} onClick={forceByFolder}>
                  <Icon name="folder_delete" />
                </button>
                <button
                  className="icon-btn"
                  title={t("backups")}
                  onClick={() => setShowBackups(true)}
                >
                  <Icon name="history" />
                </button>
                <button className="icon-btn" title={t("refresh")} onClick={reload}>
                  <Icon name="refresh" />
                </button>
              </>
            )}
            <button
              className="icon-btn"
              title={t("langToggle")}
              onClick={() => setLang(lang === "ru" ? "en" : "ru")}
            >
              <Icon name="translate" />
            </button>
            <button
              className="icon-btn"
              title={t("themeToggle")}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} />
            </button>
          </div>
        </header>

        {!elevated && (
          <div className="banner">
            <Icon name="shield" />
            <span>{t("notElevated")}</span>
            <button className="btn text" onClick={() => api.restartAsAdmin().catch(() => {})}>
              {t("restartAdmin")}
            </button>
          </div>
        )}

        <div className={view === "disk" ? "view-host" : "hidden"}>
          <DiskView dark={theme === "dark"} />
        </div>

        {view === "apps" && (
          <>
            <div className="toolbar">
              <div className="chips">
                {chips.map(([id, label]) => (
                  <button
                    key={id}
                    className={`chip ${filter === id ? "selected" : ""}`}
                    onClick={() => setFilter(id)}
                  >
                    {filter === id && <Icon name="check" />}
                    {label}
                  </button>
                ))}
              </div>
              <div className="summary">
                {!loading && (
                  <span>
                    {t("count", { n: visible.length })}
                    {totalSize > 0 && ` · ${t("totalSize", { size: formatSize(totalSize, lang) })}`}
                  </span>
                )}
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="name">{t("sortName")}</option>
                  <option value="size">{t("sortSize")}</option>
                  <option value="date">{t("sortDate")}</option>
                </select>
              </div>
            </div>

            <main className="list">
              {loading ? (
                <div className="state">
                  <Spinner />
                  <p>{t("loading")}</p>
                </div>
              ) : visible.length === 0 ? (
                <div className="state">
                  <Icon name="search_off" className="big" />
                  <p>{t("empty")}</p>
                </div>
              ) : (
                visible.map((app) => (
                  <div
                    key={app.id}
                    className={`row ${menuFor === app.id ? "menu-open" : ""}`}
                    onDoubleClick={() => setTarget({ app, force: false })}
                  >
                    <AppIcon app={app} />
                    <div className="row-main">
                      <div className="row-name">{app.name}</div>
                      <div className="row-sub">
                        {[app.publisher, app.version, app.kind === "store" ? t("storeApp") : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className="row-meta">
                      <span>{formatSize(app.sizeBytes, lang)}</span>
                      <span className="dim">{formatDate(app.installDate, lang)}</span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="btn tonal"
                        onClick={() => setTarget({ app, force: false })}
                      >
                        {t("uninstall")}
                      </button>
                      {app.kind !== "win32" ? (
                        <span style={{ width: 32, flex: "none" }} />
                      ) : (
                        <div className="menu-anchor">
                          <button
                            className="icon-btn small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuFor(menuFor === app.id ? null : app.id);
                            }}
                          >
                            <Icon name="more_vert" />
                          </button>
                          {menuFor === app.id && (
                            <div className="menu">
                              <button onClick={() => setTarget({ app, force: true })}>
                                <Icon name="bolt" />
                                {t("forceRemove")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </main>
          </>
        )}
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
      {showBackups && <BackupsDialog onClose={() => setShowBackups(false)} />}
    </I18n.Provider>
  );
}
