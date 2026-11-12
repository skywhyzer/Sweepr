import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useI18n, type Key } from "./i18n";
import type { StartupItem } from "./types";
import { Icon, Spinner } from "./ui";

type Filter = "all" | "on" | "off" | "broken";

const SOURCES: StartupItem["source"][] = ["run", "folder", "task", "service"];
const SOURCE_ICON: Record<StartupItem["source"], string> = {
  run: "apps",
  folder: "folder",
  task: "schedule",
  service: "service",
};

/** Everything that starts with Windows; switching off never deletes. */
export default function StartupPage({
  elevated,
  onRestartAdmin,
}: {
  elevated: boolean;
  onRestartAdmin: () => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<StartupItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () => {
    setList(null);
    api
      .listStartup()
      .then(setList)
      .catch(() => setList([]));
  };
  useEffect(load, []);

  const setError = (id: string, e: string | null) =>
    setErrors((x) => {
      const rest = { ...x };
      if (e) rest[id] = e;
      else delete rest[id];
      return rest;
    });

  const toggle = async (it: StartupItem) => {
    setBusy(it.id);
    setError(it.id, null);
    try {
      await api.setStartup(it.id, !it.enabled);
      setList((l) => l && l.map((x) => (x.id === it.id ? { ...x, enabled: !it.enabled } : x)));
    } catch (e) {
      setError(it.id, String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (it: StartupItem) => {
    setBusy(it.id);
    setError(it.id, null);
    try {
      await api.removeStartup(it.id, it.name);
      setList((l) => l && l.filter((x) => x.id !== it.id));
    } catch (e) {
      setError(it.id, String(e));
    } finally {
      setBusy(null);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (list ?? []).filter((it) => {
        if (filter === "on" && !it.enabled) return false;
        if (filter === "off" && it.enabled) return false;
        if (filter === "broken" && !it.missing) return false;
        if (!q) return true;
        return [it.name, it.publisher, it.description, it.command]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q));
      }),
    [list, filter, q],
  );

  const on = list?.filter((x) => x.enabled).length ?? 0;
  const broken = list?.filter((x) => x.missing).length ?? 0;
  const filters: [Filter, string][] = [
    ["all", t("stAll")],
    ["on", t("stOn")],
    ["off", t("stOff")],
  ];
  if (broken) filters.push(["broken", `${t("stBroken")} (${broken})`]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("navStartup")}</h1>
          <p>{t("startupText")}</p>
        </div>
        <label className="search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("startupSearch")}
            spellCheck={false}
          />
          {query && (
            <button className="icon-btn small" onClick={() => setQuery("")} aria-label={t("close")}>
              <Icon name="close" />
            </button>
          )}
        </label>
      </header>

      {!elevated && (
        <div className="banner page-banner">
          <Icon name="shield" />
          <span>{t("startupAdmin")}</span>
          <button className="btn text" onClick={onRestartAdmin}>
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
        <div className="spacer" />
        {list && <span className="summary">{t("startupCount", { on, n: list.length })}</span>}
        <button className="icon-btn" title={t("refresh")} onClick={load}>
          <Icon name="refresh" />
        </button>
      </div>

      <div className="page-scroll">
        {list === null ? (
          <div className="progress">
            <Spinner />
            <p className="dim">{t("startupLoading")}</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="progress dim">
            <Icon name="rocket" className="big" />
            <p>{t("startupEmpty")}</p>
          </div>
        ) : (
          <div className="settings">
            {SOURCES.map((src) => {
              const items = shown.filter((x) => x.source === src);
              if (!items.length) return null;
              return (
                <section key={src}>
                  <h3 className="tweak-cat">{t(`src_${src}` as Key)}</h3>
                  {items.map((it) => {
                    const locked = it.needsAdmin && !elevated;
                    const sub = [it.publisher ?? t("stNoPublisher"), it.description]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <div className={`card-row tweak ${it.enabled ? "" : "off"}`} key={it.id}>
                        <Icon name={SOURCE_ICON[it.source]} className="card-icon" />
                        <div className="tweak-main">
                          <div className="row-name">{it.name}</div>
                          <div className="row-sub">{sub}</div>
                          <div className="cmdline mono" title={it.command}>
                            {it.command}
                          </div>
                          <div className="tweak-tags">
                            {it.missing && (
                              <span className="badge danger">
                                <Icon name="warning" />
                                {t("stMissing")}
                              </span>
                            )}
                            {locked && (
                              <span className="badge">
                                <Icon name="shield" />
                                {t("tweaksNeedAdmin")}
                              </span>
                            )}
                            {it.source === "service" && (
                              <span className="badge">
                                <Icon name="info" />
                                {t("stServiceNote")}
                              </span>
                            )}
                          </div>
                          {(it.path && !it.missing) || errors[it.id] ? (
                            <div className="row-links">
                              {it.path && !it.missing && (
                                <button
                                  className="link"
                                  onClick={() => api.openLocation(it.path!).catch(() => {})}
                                >
                                  <Icon name="folder_open" />
                                  {t("openLocation")}
                                </button>
                              )}
                              {errors[it.id] && <div className="backup-error">{errors[it.id]}</div>}
                            </div>
                          ) : null}
                        </div>
                        {it.missing && (it.source === "run" || it.source === "folder") && (
                          <button
                            className="btn compact"
                            disabled={busy !== null || locked}
                            onClick={() => remove(it)}
                          >
                            {t("stRemove")}
                          </button>
                        )}
                        <button
                          role="switch"
                          aria-checked={it.enabled}
                          aria-label={it.name}
                          className={`switch ${it.enabled ? "on" : ""}`}
                          disabled={busy !== null || locked}
                          onClick={() => toggle(it)}
                        >
                          <span />
                        </button>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
