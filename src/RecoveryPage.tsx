import { useEffect, useState } from "react";
import { api } from "./api";
import { useI18n, type Key } from "./i18n";
import type { RepairResult, RestoreStatus } from "./types";
import { Icon, Skeleton, Spinner } from "./ui";
import BackupsSection from "./BackupsSection";

type Tab = "points" | "registry" | "repair";

/** Restore points, registry backups and the repair toolkit. */
export default function RecoveryPage({
  elevated,
  onRestartAdmin,
}: {
  elevated: boolean;
  onRestartAdmin: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("points");
  const tabs: [Tab, Key][] = [
    ["points", "tabPoints"],
    ["registry", "tabRegistry"],
    ["repair", "tabRepair"],
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("navRecovery")}</h1>
          <p>{t("recoveryText")}</p>
        </div>
      </header>
      <div className="commandbar">
        <div className="seg" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "on" : ""}
              onClick={() => setTab(id)}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      {tab === "points" && <Points elevated={elevated} onRestartAdmin={onRestartAdmin} />}
      {tab === "registry" && <BackupsSection />}
      {tab === "repair" && <Repair elevated={elevated} onRestartAdmin={onRestartAdmin} />}
    </div>
  );
}

function AdminBar({ text, onRestartAdmin }: { text: string; onRestartAdmin: () => void }) {
  const { t } = useI18n();
  return (
    <div className="banner inline">
      <Icon name="shield" />
      <span>{text}</span>
      <button className="btn text" onClick={onRestartAdmin}>
        {t("restartAdmin")}
      </button>
    </div>
  );
}

function Points({ elevated, onRestartAdmin }: { elevated: boolean; onRestartAdmin: () => void }) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [busy, setBusy] = useState<"create" | "enable" | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const load = () => {
    if (!elevated) return;
    setStatus(null);
    api
      .restoreStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, points: [] }));
  };
  useEffect(load, [elevated]);

  const create = async () => {
    setBusy("create");
    setNote(null);
    try {
      await api.createRestorePoint(t("rpManual"));
      setNote({ text: t("rpCreated"), error: false });
      load();
    } catch (e) {
      setNote({ text: `${t("rpFailed")}: ${e}`, error: true });
    } finally {
      setBusy(null);
    }
  };

  const enable = async () => {
    setBusy("enable");
    setNote(null);
    try {
      await api.enableSystemProtection();
      load();
    } catch (e) {
      setNote({ text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  if (!elevated) {
    return (
      <div className="page-scroll">
        <AdminBar text={t("rpNeedAdmin")} onRestartAdmin={onRestartAdmin} />
      </div>
    );
  }

  return (
    <>
      <div className="commandbar">
        <button
          className="btn filled"
          disabled={busy !== null || !status?.enabled}
          onClick={create}
        >
          {busy === "create" ? <Spinner /> : <Icon name="add" />}
          {busy === "create" ? t("rpCreating") : t("rpCreate")}
        </button>
        <button className="btn" onClick={() => api.openSystemRestore().catch(() => {})}>
          <Icon name="restore" />
          {t("rpOpen")}
        </button>
        <div className="spacer" />
        <button className="icon-btn" title={t("refresh")} onClick={load} disabled={busy !== null}>
          <Icon name="refresh" />
        </button>
      </div>
      <div className="page-scroll">
        {status && !status.enabled && (
          <div className="banner inline">
            <Icon name="warning" />
            <span>{t("rpOff")}</span>
            <button className="btn text" disabled={busy !== null} onClick={enable}>
              {t("rpEnable")}
            </button>
          </div>
        )}
        {note && (
          <div className={note.error ? "backup-error" : "tweak-note"}>{note.text}</div>
        )}
        <p className="tweak-note">{t("rpHint")}</p>
        {status === null ? (
          <Skeleton rows={5} />
        ) : status.points.length === 0 ? (
          <div className="progress dim">
            <Icon name="history" className="big" />
            <p>{t("rpEmpty")}</p>
          </div>
        ) : (
          <div className="settings">
            {status.points.map((p) => (
              <div className="card-row tweak" key={p.sequence}>
                <Icon name="history" className="card-icon" />
                <div className="tweak-main">
                  <div className="row-name">{p.description || "—"}</div>
                  <div className="row-sub">
                    {new Date(p.created * 1000).toLocaleString(lang, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const ACTIONS: { id: string; admin: boolean; long?: boolean; reboot?: boolean }[] = [
  { id: "sfc", admin: true, long: true },
  { id: "dism", admin: true, long: true },
  { id: "network", admin: true, reboot: true },
  { id: "dns", admin: false },
  { id: "windowsUpdate", admin: true },
  { id: "iconCache", admin: false },
  { id: "explorer", admin: false },
  { id: "componentCleanup", admin: true, long: true },
];

function Repair({ elevated, onRestartAdmin }: { elevated: boolean; onRestartAdmin: () => void }) {
  const { t } = useI18n();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RepairResult | string>>({});

  const run = async (id: string) => {
    setRunning(id);
    setResults((r) => {
      const rest = { ...r };
      delete rest[id];
      return rest;
    });
    try {
      const res = await api.runRepair(id);
      setResults((r) => ({ ...r, [id]: res }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: String(e) }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="page-scroll">
      {!elevated && <AdminBar text={t("startupAdmin")} onRestartAdmin={onRestartAdmin} />}
      <div className="settings">
        {ACTIONS.map((a) => {
          const locked = a.admin && !elevated;
          const res = results[a.id];
          const failed = typeof res === "string" || (res && !res.ok);
          return (
            <div className="card-row tweak" key={a.id}>
              <Icon name="build" className="card-icon" />
              <div className="tweak-main">
                <div className="row-name">{t(`rp_${a.id}` as Key)}</div>
                <div className="row-sub wrap">{t(`rp_${a.id}_d` as Key)}</div>
                <div className="tweak-tags">
                  {a.long && (
                    <span className="badge">
                      <Icon name="history" />
                      {t("repairLong")}
                    </span>
                  )}
                  {a.reboot && (
                    <span className="badge">
                      <Icon name="refresh" />
                      {t("tweaksReboot")}
                    </span>
                  )}
                  {locked && (
                    <span className="badge">
                      <Icon name="shield" />
                      {t("tweaksNeedAdmin")}
                    </span>
                  )}
                  {res && (
                    <span className={`badge ${failed ? "danger" : "ok-soft"}`}>
                      <Icon name={failed ? "warning" : "check"} />
                      {failed ? t("repairFail") : t("repairOk")}
                    </span>
                  )}
                </div>
                {res && typeof res !== "string" && res.ok && res.reboot && (
                  <div className="tweak-note">{t("repairReboot")}</div>
                )}
                {res && (typeof res === "string" ? res : res.output) && (
                  <details className="expander">
                    <summary>
                      <Icon name="expand_more" />
                      {t("repairOutput")}
                    </summary>
                    <pre className="mono output">{typeof res === "string" ? res : res.output}</pre>
                  </details>
                )}
              </div>
              <button
                className="btn compact"
                disabled={running !== null || locked}
                onClick={() => run(a.id)}
              >
                {running === a.id ? <Spinner /> : null}
                {running === a.id ? t("repairRunning") : t("repairRun")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
