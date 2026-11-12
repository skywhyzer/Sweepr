import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { formatDate, formatSize, useI18n, type Key } from "./i18n";
import type { AppInfo, WingetUpdate } from "./types";
import { AppIcon, Icon, Skeleton, Spinner } from "./ui";
import { log } from "./log";

type Filter = "all" | "win32" | "store" | "updates";
type Sort = "name" | "size" | "date";

interface Props {
  active: boolean;
  elevated: boolean;
  win32: AppInfo[] | null;
  store: AppInfo[] | null;
  reload: () => void;
  onUninstall: (app: AppInfo, force: boolean) => void;
  onForceFolder: () => void;
  onRestartAdmin: () => void;
  /** Newer versions winget knows about (empty when winget is missing). */
  updates: WingetUpdate[];
  onUpdated: () => void;
}

const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Link winget rows to installed programs by name; winget cuts long names with "…". */
function matchUpdates(apps: AppInfo[], ups: WingetUpdate[]): Map<string, WingetUpdate> {
  const out = new Map<string, WingetUpdate>();
  for (const u of ups) {
    const cut = u.name.endsWith("…");
    const un = normName(u.name.replace(/…$/, ""));
    if (un.length < 2) continue;
    const app = apps.find((a) => {
      const an = normName(a.name);
      return cut ? an.startsWith(un) : an === un;
    });
    if (app && !out.has(app.id) && app.version !== u.available) out.set(app.id, u);
  }
  return out;
}

/** Folder part of an icon spec / uninstall command, if it points at a file. */
function exePath(cmd: string | null | undefined): string | null {
  if (!cmd) return null;
  const m = cmd.match(/^\s*"([^"]+)"/) ?? cmd.match(/^\s*(\S+\.exe)/i);
  return m ? m[1] : null;
}

/** The program list with a details pane, as in File Explorer. */
export default function AppsPage(props: Props) {
  const { active, elevated, win32, store, reload, onUninstall, onForceFolder } = props;
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; app: AppInfo } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ i: number; n: number } | null>(null);
  const [upgradeMsg, setUpgradeMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const updateFor = useMemo(
    () => matchUpdates([...(win32 ?? []), ...(store ?? [])], props.updates),
    [win32, store, props.updates],
  );

  const visible = useMemo(() => {
    let list: AppInfo[] = [];
    if (filter !== "store") list = list.concat(win32 ?? []);
    if (filter !== "win32") list = list.concat(store ?? []);
    if (filter === "updates") list = list.filter((a) => updateFor.has(a.id));
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
  }, [win32, store, filter, query, sort, lang, updateFor]);

  const totalSize = useMemo(
    () => visible.reduce((sum, a) => sum + (a.sizeBytes ?? 0), 0),
    [visible],
  );
  const loading = win32 === null;
  const index = visible.findIndex((a) => a.id === selectedId);
  const selected = index >= 0 ? visible[index] : null;

  // Keep something selected so the details pane is never empty without reason.
  useEffect(() => {
    if (!loading && index < 0 && visible.length) setSelectedId(visible[0].id);
  }, [loading, index, visible]);

  useLayoutEffect(() => {
    if (selectedId)
      document.getElementById(`app-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key.toLowerCase() === "f") || e.key === "F3") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape") setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [active]);

  const openMenu = (x: number, y: number, app: AppInfo) => {
    setSelectedId(app.id);
    // Keep the flyout inside the window.
    const w = 260;
    const h = 180;
    setMenu({
      app,
      x: Math.min(x, window.innerWidth - w - 8),
      y: y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y,
    });
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (!visible.length) return;
    const go = (i: number) => {
      e.preventDefault();
      setSelectedId(visible[Math.max(0, Math.min(visible.length - 1, i))].id);
    };
    const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 400) / 52) - 1);
    switch (e.key) {
      case "ArrowDown":
        return go(index + 1);
      case "ArrowUp":
        return go(index - 1);
      case "PageDown":
        return go(index + page);
      case "PageUp":
        return go(index - page);
      case "Home":
        return go(0);
      case "End":
        return go(visible.length - 1);
      case "Enter":
      case "Delete":
        if (selected) {
          e.preventDefault();
          onUninstall(selected, false);
        }
        return;
      case "ContextMenu":
      case "F10":
        if (selected && (e.key === "ContextMenu" || e.shiftKey)) {
          e.preventDefault();
          const r = document.getElementById(`app-${selected.id}`)?.getBoundingClientRect();
          if (r) openMenu(r.left + 48, r.bottom - 8, selected);
        }
        return;
    }
    // Type-ahead: jump to the next program whose name starts with what was typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const now = Date.now();
      const ta = typeahead.current;
      ta.text = now - ta.at > 800 ? e.key.toLowerCase() : ta.text + e.key.toLowerCase();
      ta.at = now;
      const from = ta.text.length === 1 ? index + 1 : Math.max(index, 0);
      for (let k = 0; k < visible.length; k++) {
        const a = visible[(from + k) % visible.length];
        if (a.name.toLowerCase().startsWith(ta.text)) {
          setSelectedId(a.id);
          break;
        }
      }
    }
  };

  const filters: [Filter, string][] = [
    ["all", t("all")],
    ["win32", t("programs")],
    ["store", t("store")],
  ];
  if (updateFor.size > 0 || filter === "updates")
    filters.push(["updates", t("updates", { n: updateFor.size })]);

  const upgradeOne = async (app: AppInfo) => {
    const u = updateFor.get(app.id);
    if (!u) return false;
    setUpgrading(app.id);
    log.cmd("updates", t("lgUpdate", { name: app.name, version: u.available }));
    log.out("updates", `winget upgrade --id ${u.id}`);
    try {
      const text = await api.wingetUpgrade(u.id);
      if (text) log.out("updates", text);
      log.ok("updates", t("lgUpdateDone", { name: app.name }));
      setUpgradeMsg((m) => ({ ...m, [app.id]: { ok: true, text } }));
      return true;
    } catch (e) {
      log.err("updates", t("lgError", { error: String(e) }));
      setUpgradeMsg((m) => ({ ...m, [app.id]: { ok: false, text: String(e) } }));
      return false;
    } finally {
      setUpgrading(null);
    }
  };

  const upgrade = async (app: AppInfo) => {
    await upgradeOne(app);
    props.onUpdated();
  };

  const upgradeAll = async () => {
    const targets = visible.filter((a) => updateFor.has(a.id));
    for (let i = 0; i < targets.length; i++) {
      setBatch({ i: i + 1, n: targets.length });
      await upgradeOne(targets[i]);
    }
    setBatch(null);
    props.onUpdated();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("viewApps")}</h1>
        <label className="search">
          <Icon name="search" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "Enter") {
                e.preventDefault();
                listRef.current?.focus();
              }
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
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
      </header>

      {!elevated && (
        <div className="banner page-banner">
          <Icon name="shield" />
          <span>{t("notElevated")}</span>
          <button className="btn text" onClick={props.onRestartAdmin}>
            {t("restartAdmin")}
          </button>
        </div>
      )}

      <div className="commandbar">
        <div className="seg" role="tablist">
          {filters.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "on" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="combo"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label={t("sortName")}
        >
          <option value="name">{t("sortName")}</option>
          <option value="size">{t("sortSize")}</option>
          <option value="date">{t("sortDate")}</option>
        </select>
        <div className="spacer" />
        {filter === "updates" && updateFor.size > 0 && (
          <button
            className="btn filled"
            disabled={upgrading !== null || batch !== null}
            onClick={upgradeAll}
          >
            {batch ? <Spinner /> : <Icon name="update" />}
            {batch ? t("updatingN", batch) : t("updateAll", { n: updateFor.size })}
          </button>
        )}
        {!loading && filter !== "updates" && (
          <span className="summary optional">
            {t("count", { n: visible.length })}
            {totalSize > 0 && ` · ${t("totalSize", { size: formatSize(totalSize, lang) })}`}
          </span>
        )}
        <button className="cmd" title={t("forceFolder")} onClick={onForceFolder}>
          <Icon name="folder_delete" />
          <span>{t("folderTraces")}</span>
        </button>
        <button className="icon-btn" title={t("refresh")} onClick={reload}>
          <Icon name="refresh" />
        </button>
      </div>

      <div className="apps-body">
        <div
          ref={listRef}
          className="app-list"
          role="listbox"
          tabIndex={0}
          aria-label={t("viewApps")}
          aria-activedescendant={selected ? `app-${selected.id}` : undefined}
          onKeyDown={onListKey}
        >
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
                id={`app-${app.id}`}
                role="option"
                aria-selected={app.id === selectedId}
                className={`app-row ${app.id === selectedId ? "sel" : ""}`}
                onMouseDown={() => setSelectedId(app.id)}
                onDoubleClick={() => onUninstall(app, false)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openMenu(e.clientX, e.clientY, app);
                }}
              >
                <AppIcon app={app} />
                <div className="row-main">
                  <div className="row-name">{app.name}</div>
                  <div className="row-sub">
                    {app.publisher || (app.kind === "store" ? t("storeApp") : "")}
                    {updateFor.has(app.id) && (
                      <span className="upd">
                        <Icon name="update" />
                        {updateFor.get(app.id)!.available}
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-size">{formatSize(app.sizeBytes, lang)}</div>
                <div className="col-date">{formatDate(app.installDate, lang)}</div>
              </div>
            ))
          )}
        </div>

        <Details
          app={selected}
          onUninstall={onUninstall}
          empty={!loading && visible.length === 0}
          update={selected ? updateFor.get(selected.id) : undefined}
          upgrading={selected !== null && upgrading === selected.id}
          upgradeLocked={upgrading !== null || batch !== null}
          upgradeMsg={selected ? upgradeMsg[selected.id] : undefined}
          onUpgrade={upgrade}
        />
      </div>

      {menu && (
        <div
          className="menu context"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              onUninstall(menu.app, false);
            }}
          >
            <Icon name="delete" />
            {t("uninstall")}
          </button>
          {menu.app.kind === "win32" && (
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onUninstall(menu.app, true);
              }}
            >
              <Icon name="bolt" />
              {t("forceRemove")}
            </button>
          )}
          <div className="menu-sep" />
          {(menu.app.installLocation || exePath(menu.app.uninstallString)) && (
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                api
                  .openLocation(menu.app.installLocation || exePath(menu.app.uninstallString)!)
                  .catch(() => {});
              }}
            >
              <Icon name="folder_open" />
              {t("openLocation")}
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              navigator.clipboard.writeText(menu.app.name).catch(() => {});
            }}
          >
            <Icon name="content_copy" />
            {t("copyName")}
          </button>
        </div>
      )}
    </div>
  );
}

function Details({
  app,
  empty,
  onUninstall,
  update,
  upgrading,
  upgradeLocked,
  upgradeMsg,
  onUpgrade,
}: {
  app: AppInfo | null;
  empty: boolean;
  onUninstall: (app: AppInfo, force: boolean) => void;
  update?: WingetUpdate;
  upgrading: boolean;
  upgradeLocked: boolean;
  upgradeMsg?: { ok: boolean; text: string };
  onUpgrade: (app: AppInfo) => void;
}) {
  const { t, lang } = useI18n();

  if (!app) {
    return (
      <aside className="details">
        <div className="state">
          {!empty && <Icon name="info" className="big" />}
          {!empty && <p>{t("selectHint")}</p>}
        </div>
      </aside>
    );
  }

  const kind: Key =
    app.kind === "store" ? "kindStore" : app.isMsi ? "kindMsi" : "kindWin32";
  const location = app.installLocation || null;
  const folderTarget = location || exePath(app.uninstallString);

  return (
    <aside className="details" key={app.id}>
      <div className="details-head">
        <AppIcon app={app} />
        <div className="details-title">
          <h2 title={app.name}>{app.name}</h2>
          {app.publisher && <div className="row-sub">{app.publisher}</div>}
        </div>
      </div>

      <div className="details-actions">
        <button className="btn filled" onClick={() => onUninstall(app, false)}>
          <Icon name="delete" />
          {t("uninstall")}
        </button>
        {app.kind === "win32" && (
          <button className="btn" onClick={() => onUninstall(app, true)}>
            <Icon name="bolt" />
            {t("forceShort")}
          </button>
        )}
        {update && (
          <button
            className="btn update-btn"
            disabled={upgradeLocked}
            onClick={() => onUpgrade(app)}
          >
            {upgrading ? <Spinner /> : <Icon name="update" />}
            {upgrading ? t("updating") : t("updateTo", { v: update.available })}
          </button>
        )}
      </div>
      {upgradeMsg && (
        <div className={upgradeMsg.ok ? "tweak-note" : "backup-error"} title={upgradeMsg.text}>
          {upgradeMsg.ok ? t("updateDone") : `${t("updateFailed")}: ${upgradeMsg.text}`}
        </div>
      )}

      <dl className="props">
        <Prop label={t("pKind")} value={t(kind)} />
        <Prop label={t("pVersion")} value={app.version} />
        {update && <Prop label={t("pAvailable")} value={update.available} />}
        <Prop label={t("pSize")} value={formatSize(app.sizeBytes, lang)} />
        <Prop label={t("pDate")} value={formatDate(app.installDate, lang)} />
        <Prop
          label={t("pLocation")}
          value={location}
          copy
          action={
            folderTarget && (
              <button
                className="link"
                onClick={() => api.openLocation(folderTarget).catch(() => {})}
              >
                <Icon name="folder_open" />
                {t("openLocation")}
              </button>
            )
          }
        />
        <Prop label={t("pUninstaller")} value={app.uninstallString} mono copy />
        <Prop label={t("pRegistry")} value={app.registryKey} mono copy />
        <Prop label={t("pPackage")} value={app.packageFullName} mono copy />
      </dl>
    </aside>
  );
}

function Prop({
  label,
  value,
  mono,
  copy,
  action,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  copy?: boolean;
  action?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!value && !action) return null;
  return (
    <div className="prop">
      <dt>
        {label}
        {copy && value && (
          <button
            className="icon-btn small"
            title={copied ? t("copied") : t("copy")}
            onClick={() =>
              navigator.clipboard.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            <Icon name={copied ? "check" : "content_copy"} />
          </button>
        )}
      </dt>
      {value && <dd className={mono ? "mono" : ""}>{value}</dd>}
      {action && <dd>{action}</dd>}
    </div>
  );
}
