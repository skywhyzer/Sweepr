import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatSize, useI18n, type Key } from "./i18n";
import { log, useLog } from "./log";
import { LogView } from "./LogView";
import type { RepairResult, RestorePoint, RestoreStatus } from "./types";
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

function kindKey(kind: number): Key {
  switch (kind) {
    case 0:
      return "rpKind0";
    case 1:
      return "rpKind1";
    case 10:
      return "rpKind10";
    case 12:
      return "rpKind12";
    case 13:
      return "rpKind13";
    default:
      return "rpKindOther";
  }
}

function Points({ elevated, onRestartAdmin }: { elevated: boolean; onRestartAdmin: () => void }) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [busy, setBusy] = useState<"create" | "enable" | "delete" | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<RestorePoint[] | null>(null);

  const load = () => {
    if (!elevated) return;
    setStatus(null);
    setPicked(new Set());
    api
      .restoreStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, points: [] }));
  };
  useEffect(load, [elevated]);

  const create = async () => {
    setBusy("create");
    setNote(null);
    log.cmd("restore", t("lgRpManualCreate"));
    try {
      await api.createRestorePoint(t("rpManual"));
      log.ok("restore", t("lgRpOk"));
      setNote({ text: t("rpCreated"), error: false });
      load();
    } catch (e) {
      log.err("restore", t("lgRpFail", { error: String(e) }));
      setNote({ text: `${t("rpFailed")}: ${e}`, error: true });
    } finally {
      setBusy(null);
    }
  };

  const enable = async () => {
    setBusy("enable");
    setNote(null);
    log.cmd("restore", t("lgRpEnable"));
    try {
      await api.enableSystemProtection();
      log.ok("restore", t("lgRpEnabled"));
      load();
    } catch (e) {
      log.err("restore", t("lgError", { error: String(e) }));
      setNote({ text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    const list = confirm;
    setBusy("delete");
    setNote(null);
    log.cmd("restore", t("lgRpDelete", { n: list.length }));
    try {
      const r = await api.deleteRestorePoints(list.map((p) => p.sequence));
      for (const seq of r.deleted) {
        const p = list.find((x) => x.sequence === seq);
        log.ok("restore", t("lgRpDeleted", { seq, desc: p?.description || "—" }));
      }
      for (const f of r.failed)
        log.err("restore", t("lgRpDelFail", { seq: f.sequence, error: f.error }));
      if (r.deleted.length) log.ok("restore", t("lgRpDeleteDone", { n: r.deleted.length }));
      if (r.failed.length)
        setNote({
          text: t("lgRpDelFail", { seq: r.failed[0].sequence, error: r.failed[0].error }),
          error: true,
        });
    } catch (e) {
      log.err("restore", t("lgError", { error: String(e) }));
      setNote({ text: String(e), error: true });
    } finally {
      setBusy(null);
      setConfirm(null);
      load();
    }
  };

  const points = status?.points ?? [];
  const allPicked = points.length > 0 && picked.size === points.length;
  const toggle = (seq: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(seq)) n.add(seq);
      return n;
    });
  const used = status?.usedBytes ? formatSize(status.usedBytes, lang) : "";
  const max = status?.maxBytes ? formatSize(status.maxBytes, lang) : "";

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
        {points.length > 1 && (
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => setConfirm(points.slice(1))}
          >
            <Icon name="delete_sweep" />
            {t("rpKeepLast")}
          </button>
        )}
        <button
          className="btn danger-soft"
          disabled={busy !== null || picked.size === 0}
          onClick={() => setConfirm(points.filter((p) => picked.has(p.sequence)))}
        >
          <Icon name="delete" />
          {t("rpDeleteSelected", { n: picked.size })}
        </button>
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
        {status && (
          <p className="tweak-note">
            {used ? (max ? t("rpUsedOf", { used, max }) : t("rpUsed", { used })) + ". " : ""}
            {t("rpWhere")}
          </p>
        )}
        {status === null ? (
          <Skeleton rows={5} />
        ) : points.length === 0 ? (
          <div className="progress dim">
            <Icon name="history" className="big" />
            <p>{t("rpEmpty")}</p>
          </div>
        ) : (
          <div className="settings">
            <label className="check-row point-all">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() =>
                  setPicked(allPicked ? new Set() : new Set(points.map((p) => p.sequence)))
                }
              />
              <span>{t("rpSelectAll")}</span>
            </label>
            {points.map((p) => (
              <div
                className={`card-row tweak ${picked.has(p.sequence) ? "picked" : ""}`}
                key={p.sequence}
              >
                <input
                  type="checkbox"
                  className="point-check"
                  aria-label={p.description}
                  checked={picked.has(p.sequence)}
                  onChange={() => toggle(p.sequence)}
                />
                <Icon name="history" className="card-icon" />
                <div className="tweak-main">
                  <div className="row-name">{p.description || "—"}</div>
                  <div className="row-sub">
                    {new Date(p.created * 1000).toLocaleString(lang, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {` · №${p.sequence}`}
                  </div>
                  <div className="tweak-tags">
                    <span className="badge">{t(kindKey(p.kind))}</span>
                    {p.description.startsWith("Sweepr") && (
                      <span className="badge ok-soft">
                        <Icon name="check" />
                        {t("rpBySweepr")}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="icon-btn danger-icon"
                  title={t("rpDelete")}
                  disabled={busy !== null}
                  onClick={() => setConfirm([p])}
                >
                  <Icon name="delete" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <div
          className="scrim"
          onMouseDown={(e) => e.target === e.currentTarget && busy !== "delete" && setConfirm(null)}
        >
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{t("rpDeleteTitle")}</h2>
            <p>{t("rpDeleteText", { n: confirm.length })}</p>
            <div className="note-list">
              {confirm.slice(0, 6).map((p) => (
                <div key={p.sequence} className="row-sub">
                  №{p.sequence} · {p.description || "—"}
                </div>
              ))}
              {confirm.length > 6 && (
                <div className="row-sub">{t("lgMore", { n: confirm.length - 6 })}</div>
              )}
            </div>
            <div className="dialog-actions">
              <button className="btn text" disabled={busy === "delete"} onClick={() => setConfirm(null)}>
                {t("cancel")}
              </button>
              <button className="btn danger" disabled={busy === "delete"} onClick={doDelete} autoFocus>
                {busy === "delete" ? <Spinner /> : null}
                {busy === "delete" ? t("rpDeleting") : t("rpDelete")}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const all = useLog();
  const mine = useMemo(() => all.filter((e) => e.scope === "repair").slice(-200), [all]);

  const run = async (id: string) => {
    const name = t(`rp_${id}` as Key);
    setRunning(id);
    setResults((r) => {
      const rest = { ...r };
      delete rest[id];
      return rest;
    });
    log.cmd("repair", t("lgRepairRun", { name }));
    try {
      const res = await api.runRepair(id);
      if (res.output) log.out("repair", res.output);
      if (res.ok) {
        log.ok("repair", `${name}: ${t("lgRepairOk")}`);
        if (res.reboot) log.warn("repair", t("lgRepairReboot"));
      } else {
        log.err("repair", `${name}: ${t("lgRepairFail")}`);
      }
      setResults((r) => ({ ...r, [id]: res }));
    } catch (e) {
      log.err("repair", t("lgError", { error: String(e) }));
      setResults((r) => ({ ...r, [id]: String(e) }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="page-scroll">
      {!elevated && <AdminBar text={t("startupAdmin")} onRestartAdmin={onRestartAdmin} />}
      {(mine.length > 0 || running !== null) && (
        <div className="log-block top">
          <LogView
            entries={mine}
            title={t("repairOutput")}
            live={running !== null}
            empty={t("logEmpty")}
          />
        </div>
      )}
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
