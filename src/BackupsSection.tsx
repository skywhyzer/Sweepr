import { useEffect, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import type { BackupInfo } from "./types";
import { Icon, Skeleton } from "./ui";
import { log } from "./log";

type Status = "busy" | "restored" | "failed";

/** Lists registry backups made during uninstalls and restores them on request. */
export default function BackupsSection() {
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
    const name = list?.find((b) => b.id === id)?.appName ?? id;
    log.cmd("backups", t("lgBackupRestore", { name }));
    try {
      const n = await api.restoreBackup(id);
      log.ok("backups", t("lgBackupRestored", { n }));
      setStatus((s) => ({ ...s, [id]: "restored" }));
    } catch (e) {
      log.err("backups", t("lgError", { error: String(e) }));
      setErrors((x) => ({ ...x, [id]: String(e) }));
      setStatus((s) => ({ ...s, [id]: "failed" }));
    }
  };

  const remove = async (id: string) => {
    const name = list?.find((b) => b.id === id)?.appName ?? id;
    await api.deleteBackup(id).catch(() => {});
    log.info("backups", t("lgBackupDelete", { name }));
    load();
  };

  return (
    <div className="page-scroll">
        <div className="section-intro">
          <p>{t("backupsText")}</p>
          <button className="icon-btn" title={t("refresh")} onClick={load}>
            <Icon name="refresh" />
          </button>
        </div>
        {list === null ? (
          <Skeleton rows={5} />
        ) : list.length === 0 ? (
          <div className="progress dim">
            <Icon name="history" className="big" />
            <p>{t("backupsEmpty")}</p>
          </div>
        ) : (
          <div className="settings">
            {list.map((b) => (
              <div key={b.id} className="card-row backup">
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
    </div>
  );
}
