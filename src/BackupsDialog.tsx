import { useEffect, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import type { BackupInfo } from "./types";
import { Icon, Spinner } from "./ui";

type Status = "busy" | "restored" | "failed";

/** Lists registry backups made during uninstalls and restores them on request. */
export default function BackupsDialog({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  const load = () => api.listBackups().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);

  const restore = async (id: string) => {
    setStatus((s) => ({ ...s, [id]: "busy" }));
    try {
      await api.restoreBackup(id);
      setStatus((s) => ({ ...s, [id]: "restored" }));
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: String(e) }));
      setStatus((s) => ({ ...s, [id]: "failed" }));
    }
  };

  const remove = async (id: string) => {
    await api.deleteBackup(id).catch(() => {});
    load();
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true">
        <h2>{t("backups")}</h2>
        <p>{t("backupsText")}</p>

        {list === null ? (
          <div className="progress">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <div className="progress dim">
            <Icon name="history" className="big" />
            <p>{t("backupsEmpty")}</p>
          </div>
        ) : (
          <div className="leftovers tall">
            {list.map((b) => (
              <div key={b.id} className="backup">
                <div className="backup-row">
                  <button
                    className="icon-btn small"
                    onClick={() => setOpen(open === b.id ? null : b.id)}
                    title={t("backupDetails")}
                  >
                    <Icon name={open === b.id ? "expand_less" : "expand_more"} />
                  </button>
                  <div className="leftover-main">
                    <div className="row-name">{b.appName || "—"}</div>
                    <div className="row-sub">
                      {new Date(b.created * 1000).toLocaleString(lang, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {" · "}
                      {t("backupEntries", { n: b.entries.length })}
                    </div>
                  </div>
                  {status[b.id] === "restored" ? (
                    <span className="badge ok">
                      <Icon name="check" />
                      {t("restored")}
                    </span>
                  ) : (
                    <button
                      className="btn tonal compact"
                      disabled={status[b.id] === "busy"}
                      onClick={() => restore(b.id)}
                    >
                      {t("restore")}
                    </button>
                  )}
                  <button
                    className="icon-btn small"
                    title={t("deleteBackup")}
                    onClick={() => remove(b.id)}
                  >
                    <Icon name="delete" />
                  </button>
                </div>
                {status[b.id] === "failed" && (
                  <div className="backup-error">
                    {t("restoreFailed")}: {errors[b.id]}
                  </div>
                )}
                {open === b.id && (
                  <div className="backup-entries">
                    {b.entries.map((e) => (
                      <div className="leftover-path" key={e} title={e}>
                        {e}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn filled" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
