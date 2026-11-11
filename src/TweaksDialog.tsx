import { useEffect, useState } from "react";
import { api } from "./api";
import { useI18n, type Key } from "./i18n";
import type { TweakInfo } from "./types";
import { Icon, Spinner } from "./ui";

const CATEGORIES: TweakInfo["category"][] = ["interface", "privacy", "gaming", "updates"];

/** Toggles for system settings; every change can be undone, even after a restart. */
export default function TweaksDialog({
  elevated,
  onClose,
}: {
  elevated: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<TweakInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [explorerPending, setExplorerPending] = useState(false);

  useEffect(() => {
    api.listTweaks().then(setList).catch(() => setList([]));
  }, []);

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
      setList((l) => l && l.map((x) => (x.id === tw.id ? updated : x)));
      if (tw.explorer) setExplorerPending(true);
    } catch (e) {
      setErrors((x) => ({ ...x, [tw.id]: String(e) }));
    } finally {
      setBusy(null);
    }
  };

  const resetAll = async () => {
    setBusy("*");
    setNote(null);
    try {
      const n = await api.resetTweaks();
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

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true">
        <h2>{t("tweaks")}</h2>
        <p>{t("tweaksText")}</p>

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
          <div className="progress">
            <Spinner />
          </div>
        ) : (
          <div className="leftovers tall">
            {CATEGORIES.map((cat) => {
              const items = list.filter((x) => x.category === cat);
              if (items.length === 0) return null;
              return (
                <section key={cat}>
                  <div className="tweak-cat">{t(`cat_${cat}` as Key)}</div>
                  {items.map((tw) => {
                    const locked = tw.admin && !elevated;
                    const title = t(`tw_${tw.id}` as Key);
                    return (
                      <div className="tweak" key={tw.id}>
                        <div className="tweak-main">
                          <div className="row-name">{title}</div>
                          <div className="row-sub wrap">{t(`tw_${tw.id}_d` as Key)}</div>
                          <div className="tweak-tags">
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
                            onClick={() => toggle(tw, true)}
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
                            onClick={() => toggle(tw, !tw.enabled)}
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

        <div className="dialog-actions">
          <button className="btn text" disabled={busy !== null || managed === 0} onClick={resetAll}>
            {t("tweaksReset")}
          </button>
          <button className="btn filled" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
