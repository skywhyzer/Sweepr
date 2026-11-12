import { useEffect, useState } from "react";
import { api } from "./api";
import { useI18n, type Key } from "./i18n";
import type { TweakInfo } from "./types";
import { Icon, Spinner } from "./ui";

const CATEGORIES: TweakInfo["category"][] = ["interface", "privacy", "gaming", "updates"];

/** Toggles for system settings; every change can be undone, even after a restart. */
export default function TweaksPage({ elevated }: { elevated: boolean }) {
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
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("tweaks")}</h1>
          <p>{t("tweaksText")}</p>
        </div>
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
          <div className="progress">
            <Spinner />
          </div>
        ) : (
          <div className="settings">
            {CATEGORIES.map((cat) => {
              const items = list.filter((x) => x.category === cat);
              if (items.length === 0) return null;
              return (
                <section key={cat}>
                  <h3 className="tweak-cat">{t(`cat_${cat}` as Key)}</h3>
                  {items.map((tw) => {
                    const locked = tw.admin && !elevated;
                    const title = t(`tw_${tw.id}` as Key);
                    return (
                      <div className="card-row tweak" key={tw.id}>
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

      </div>
    </div>
  );
}
