import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useI18n, type Key } from "./i18n";
import type { TweakInfo } from "./types";
import { Icon, Skeleton } from "./ui";
import { log } from "./log";
import { getPref, safetyRestorePoint } from "./prefs";

const CATEGORIES: TweakInfo["category"][] = [
  "interface",
  "privacy",
  "gaming",
  "updates",
  "security",
];

/** Toggles for system settings; every change can be undone, even after a restart. */
export default function TweaksPage({ elevated }: { elevated: boolean }) {
  const { t } = useI18n();
  const [list, setList] = useState<TweakInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [explorerPending, setExplorerPending] = useState(false);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<TweakInfo | null>(null);

  useEffect(() => {
    api
      .listTweaks()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirm(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  const toggle = async (tw: TweakInfo, enabled: boolean) => {
    setBusy(tw.id);
    setNote(null);
    setErrors((e) => {
      const rest = { ...e };
      delete rest[tw.id];
      return rest;
    });
    try {
      const updated = await api.setTweak(tw.id, enabled);
      log.ok(
        "tweaks",
        t("lgTweakSet", {
          name: t(`tw_${tw.id}` as Key),
          state: t(enabled ? "lgStateOn" : "lgStateOff"),
        }),
      );
      setList((l) => l && l.map((x) => (x.id === tw.id ? updated : x)));
      if (tw.explorer) setExplorerPending(true);
    } catch (e) {
      log.err("tweaks", t("lgError", { error: `${t(`tw_${tw.id}` as Key)}: ${e}` }));
      setErrors((x) => ({ ...x, [tw.id]: String(e) }));
    } finally {
      setBusy(null);
    }
  };

  // High-risk tweaks ask for confirmation before they are switched on.
  const onToggle = (tw: TweakInfo, next: boolean) => {
    if (next && tw.risk === "high") setConfirm(tw);
    else toggle(tw, next);
  };

  const resetAll = async () => {
    setBusy("*");
    setNote(null);
    try {
      const n = await api.resetTweaks();
      log.ok("tweaks", t("lgTweaksReset", { n }));
      setNote(n === 0 ? t("tweaksResetNone") : t("tweaksResetDone", { n }));
      if (n > 0) setExplorerPending(true);
    } catch (e) {
      setNote(`${t("tweaksFailed")}: ${e}`);
    } finally {
      setList(await api.listTweaks().catch(() => list ?? []));
      setBusy(null);
    }
  };

  const restartExplorer = async () => {
    setBusy("explorer");
    await api.restartExplorer().catch(() => {});
    setExplorerPending(false);
    setBusy(null);
  };

  const managed = list?.filter((x) => x.managed).length ?? 0;

  // Filter by the translated title and description so search works per language.
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const set = new Set<string>();
    for (const tw of list ?? []) {
      const hay = `${t(`tw_${tw.id}` as Key)} ${t(`tw_${tw.id}_d` as Key)}`.toLowerCase();
      if (hay.includes(q)) set.add(tw.id);
    }
    return set;
  }, [q, list, t]);

  const found = matches ? (list ?? []).filter((x) => matches.has(x.id)) : list;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("tweaks")}</h1>
          <p>{t("tweaksText")}</p>
        </div>
        <label className="search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tweaksSearch")}
            spellCheck={false}
          />
          {query && (
            <button className="icon-btn small" onClick={() => setQuery("")} aria-label={t("close")}>
              <Icon name="close" />
            </button>
          )}
        </label>
        <button className="btn" disabled={busy !== null || managed === 0} onClick={resetAll}>
          <Icon name="undo" />
          {t("tweaksReset")}
        </button>
      </header>

      <div className="page-scroll">
        {explorerPending && (
          <div className="banner inline">
            <Icon name="info" />
            <span>{t("tweaksExplorer")}</span>
            <button className="btn text" disabled={busy !== null} onClick={restartExplorer}>
              {t("tweaksRestartExplorer")}
            </button>
          </div>
        )}
        {note && <div className="tweak-note">{note}</div>}

        {list === null ? (
          <Skeleton rows={5} />
        ) : found && found.length === 0 ? (
          <div className="progress dim">
            <Icon name="search_off" className="big" />
            <p>{t("tweaksNothing")}</p>
          </div>
        ) : (
          <div className="settings">
            {CATEGORIES.map((cat) => {
              const items = (found ?? []).filter((x) => x.category === cat);
              if (items.length === 0) return null;
              return (
                <section key={cat}>
                  <h3 className="tweak-cat">{t(`cat_${cat}` as Key)}</h3>
                  {cat === "security" && !q && (
                    <div className="banner inline info">
                      <Icon name="info" />
                      <span>{t("tweaksDefenderNote")}</span>
                    </div>
                  )}
                  {items.map((tw) => {
                    const locked = tw.admin && !elevated;
                    const title = t(`tw_${tw.id}` as Key);
                    return (
                      <div className="card-row tweak" key={tw.id}>
                        <div className="tweak-main">
                          <div className="row-name">{title}</div>
                          <div className="row-sub wrap">{t(`tw_${tw.id}_d` as Key)}</div>
                          <div className="tweak-tags">
                            {tw.risk === "high" && (
                              <span className="badge danger">
                                <Icon name="warning" />
                                {t("tweaksHigh")}
                              </span>
                            )}
                            {tw.risk === "medium" && (
                              <span className="badge warn">
                                <Icon name="warning" />
                                {t("tweaksMedium")}
                              </span>
                            )}
                            {locked && (
                              <span className="badge">
                                <Icon name="shield" />
                                {t("tweaksNeedAdmin")}
                              </span>
                            )}
                            {tw.reboot && (
                              <span className="badge">
                                <Icon name="refresh" />
                                {t("tweaksReboot")}
                              </span>
                            )}
                            {tw.relogin && (
                              <span className="badge">
                                <Icon name="logout" />
                                {t("tweaksRelogin")}
                              </span>
                            )}
                            {tw.drift ? (
                              <span className="badge warn">
                                <Icon name="undo" />
                                {t("tweaksDrift")}
                              </span>
                            ) : (
                              tw.managed && (
                                <span className="badge">
                                  <Icon name="history" />
                                  {t("tweaksChanged")}
                                </span>
                              )
                            )}
                          </div>
                          {errors[tw.id] && <div className="backup-error">{errors[tw.id]}</div>}
                        </div>
                        {tw.drift ? (
                          <button
                            className="btn tonal compact"
                            disabled={busy !== null || locked}
                            onClick={() => onToggle(tw, true)}
                          >
                            {t("tweaksReapply")}
                          </button>
                        ) : (
                          <button
                            role="switch"
                            aria-checked={tw.enabled}
                            aria-label={title}
                            className={`switch ${tw.enabled ? "on" : ""}`}
                            disabled={busy !== null || locked}
                            onClick={() => onToggle(tw, !tw.enabled)}
                          >
                            <span />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {confirm && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="dialog" role="dialog" aria-modal="true">
            <div className="status-head">
              <div className="status-mark warn">
                <Icon name="warning" />
              </div>
              <h2>{t("tweakConfirmTitle", { name: t(`tw_${confirm.id}` as Key) })}</h2>
            </div>
            <p>{t(`tw_${confirm.id}_d` as Key)}</p>
            <p className="note">
              <Icon name="info" />
              <span>{t("tweakConfirmHigh")}</span>
            </p>
            <div className="dialog-actions">
              <button className="btn text" onClick={() => setConfirm(null)}>
                {t("cancel")}
              </button>
              <button
                className="btn danger"
                autoFocus
                onClick={async () => {
                  const tw = confirm;
                  setConfirm(null);
                  setBusy(tw.id);
                  setNote(t("stepRestorePoint"));
                  const point = `Sweepr: ${t(`tw_${tw.id}` as Key)}`;
                  if (getPref("autoRestore", true)) {
                    log.cmd("restore", t("lgRpCreate", { name: point }));
                    if (await safetyRestorePoint(point)) log.ok("restore", t("lgRpOk"));
                    else log.warn("restore", t("lgRpFail", { error: t("optRestoreNoAdmin") }));
                  } else {
                    log.info("restore", t("lgRpSkipSetting"));
                  }
                  setNote(null);
                  toggle(tw, true);
                }}
              >
                {t("tweakApply")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
