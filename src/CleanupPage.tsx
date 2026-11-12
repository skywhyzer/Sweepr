import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatSize, useI18n, type Key } from "./i18n";
import type { CleanCategory, Leftover, Orphan } from "./types";
import { Icon, Skeleton, Spinner } from "./ui";
import { log } from "./log";

type Tab = "junk" | "orphans";

/** Junk files and leftovers of programs that are already gone. */
export default function CleanupPage({
  elevated,
  onRestartAdmin,
}: {
  elevated: boolean;
  onRestartAdmin: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("junk");

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{t("navCleanup")}</h1>
          <p>{t("cleanupText")}</p>
        </div>
      </header>
      <div className="commandbar">
        <div className="seg" role="tablist">
          {(["junk", "orphans"] as Tab[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "on" : ""}
              onClick={() => setTab(id)}
            >
              {t(id === "junk" ? "tabJunk" : "tabOrphans")}
            </button>
          ))}
        </div>
      </div>
      {tab === "junk" ? (
        <Junk elevated={elevated} onRestartAdmin={onRestartAdmin} />
      ) : (
        <Orphans />
      )}
    </div>
  );
}

function Junk({ elevated, onRestartAdmin }: { elevated: boolean; onRestartAdmin: () => void }) {
  const { t, lang } = useI18n();
  const [cats, setCats] = useState<CleanCategory[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<{ freed: number; skipped: number } | null>(null);

  const scan = () => {
    setCats(null);
    log.cmd("cleanup", t("lgCleanScan"));
    api
      .scanCleanup()
      .then((c) => {
        const free = c.filter((x) => !x.manual).reduce((s, x) => s + x.sizeBytes, 0);
        log.ok("cleanup", t("lgCleanScanDone", { size: formatSize(free, lang) || "0" }));
        c.filter((x) => x.sizeBytes > 0).forEach((x) =>
          log.out(
            "cleanup",
            `${t(`cl_${x.id}` as Key)}: ${formatSize(x.sizeBytes, lang)} (${x.files})${x.needsAdmin && !elevated ? " · admin" : ""}`,
          ),
        );
        setCats(c);
        // Everything with something to clean is selected, except the Recycle
        // Bin: emptying it is the user's call.
        setChecked(
          new Set(c.filter((x) => x.sizeBytes > 0 && !x.manual && x.id !== "recycleBin").map((x) => x.id)),
        );
      })
      .catch(() => setCats([]));
  };
  useEffect(scan, []);

  const selectedSize = useMemo(
    () => (cats ?? []).filter((c) => checked.has(c.id)).reduce((s, c) => s + c.sizeBytes, 0),
    [cats, checked],
  );
  const total = (cats ?? []).filter((c) => !c.manual).reduce((s, c) => s + c.sizeBytes, 0);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const clean = async () => {
    setConfirm(false);
    setCleaning(true);
    setResult(null);
    log.cmd("cleanup", t("lgCleanRun", { n: checked.size }));
    try {
      const res = await api.runCleanup([...checked]);
      res.forEach((r) =>
        log.info(
          "cleanup",
          t("lgCleanItem", {
            name: t(`cl_${r.id}` as Key),
            size: formatSize(r.freedBytes, lang) || "0",
            skipped: r.skipped,
          }),
        ),
      );
      log.ok(
        "cleanup",
        t("lgCleanDone", { size: formatSize(res.reduce((s, r) => s + r.freedBytes, 0), lang) || "0" }),
      );
      setResult({
        freed: res.reduce((s, r) => s + r.freedBytes, 0),
        skipped: res.reduce((s, r) => s + r.skipped, 0),
      });
    } catch (e) {
      log.err("cleanup", t("lgError", { error: String(e) }));
      setResult({ freed: 0, skipped: 0 });
    } finally {
      setCleaning(false);
      scan();
    }
  };

  const anyPartial = cats?.some((c) => c.partial) ?? false;

  return (
    <>
      <div className="commandbar">
        <button className="cmd" onClick={scan} disabled={cats === null || cleaning}>
          <Icon name="refresh" />
          <span>{t("clRescan")}</span>
        </button>
        <div className="spacer" />
        {cats && <span className="summary">{t("clSelected", { size: formatSize(selectedSize, lang) || "0" })}</span>}
        <button
          className="btn filled"
          disabled={!cats || cleaning || checked.size === 0 || selectedSize === 0}
          onClick={() => setConfirm(true)}
        >
          {cleaning ? <Spinner /> : <Icon name="delete_sweep" />}
          {t("clClean")}
        </button>
      </div>

      <div className="page-scroll">
        {!elevated && anyPartial && (
          <div className="banner inline">
            <Icon name="shield" />
            <span>{t("clPartial")}</span>
            <button className="btn text" onClick={onRestartAdmin}>
              {t("restartAdmin")}
            </button>
          </div>
        )}
        {result && (
          <div className="banner inline info">
            <Icon name="check" />
            <span>
              {t("clDone", { size: formatSize(result.freed, lang) || "0" })}
              {result.skipped > 0 && ` ${t("clSkipped", { n: result.skipped })}`}
            </span>
          </div>
        )}
        {cats === null ? (
          <div className="progress">
            <Spinner />
            <p className="dim">{t("clScanning")}</p>
          </div>
        ) : (
          <div className="settings">
            <div className="clean-total">{formatSize(total, lang) || "0"}</div>
            <div className="clean-total-label">{t("clCanFree")}</div>
            {cats.map((c) => {
              const empty = c.sizeBytes === 0;
              if (c.manual && empty) return null;
              return (
                <label className={`card-row tweak clean-row ${empty ? "empty" : ""}`} key={c.id}>
                  {c.manual ? (
                    <Icon name="info" className="card-icon" />
                  ) : (
                    <input
                      type="checkbox"
                      checked={checked.has(c.id)}
                      disabled={empty || cleaning}
                      onChange={() => toggle(c.id)}
                    />
                  )}
                  <div className="tweak-main">
                    <div className="row-name">{t(`cl_${c.id}` as Key)}</div>
                    <div className="row-sub wrap">{t(`cl_${c.id}_d` as Key)}</div>
                    {c.partial && (
                      <div className="tweak-tags">
                        <span className="badge">
                          <Icon name="shield" />
                          {t("clPartial")}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="clean-size">{empty ? t("clNothing") : formatSize(c.sizeBytes, lang)}</div>
                  {c.manual && (
                    <button
                      className="btn compact"
                      onClick={(e) => {
                        e.preventDefault();
                        api.openStorageSettings().catch(() => {});
                      }}
                    >
                      {t("clOpenSettings")}
                    </button>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {confirm && (
        <Confirm
          title={t("clConfirmTitle")}
          text={t("clConfirmText", { size: formatSize(selectedSize, lang) })}
          action={t("clClean")}
          onCancel={() => setConfirm(false)}
          onOk={clean}
        />
      )}
    </>
  );
}

function Orphans() {
  const { t, lang } = useI18n();
  const [list, setList] = useState<Orphan[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const scan = async () => {
    setScanning(true);
    setNote(null);
    setChecked(new Set());
    log.cmd("cleanup", t("lgOrphanScan"));
    try {
      const found = await api.scanOrphans();
      log.ok("cleanup", t("lgOrphanDone", { n: found.length }));
      found.forEach((o) =>
        log.out("cleanup", `${o.path} — ${formatSize(o.sizeBytes, lang) || "0"}`),
      );
      setList(found);
    } catch (e) {
      log.err("cleanup", t("lgError", { error: String(e) }));
      setList([]);
    } finally {
      setScanning(false);
    }
  };

  const toggle = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const selected = (list ?? []).filter((o) => checked.has(o.path));

  const remove = async () => {
    setConfirm(false);
    setBusy(true);
    const items: Leftover[] = selected.map((o) => ({
      kind: o.kind,
      path: o.path,
      valueName: null,
      sizeBytes: o.sizeBytes,
      confidence: "review",
      reason: "orphan",
    }));
    log.cmd("cleanup", t("lgOrphanDelete", { n: items.length }));
    try {
      const r = await api.deleteLeftovers(items, true, true, t("tabOrphans"), null);
      r.failed.forEach((f) => log.err("cleanup", t("lgDeleteFail", { path: f.path, error: f.error })));
      log.ok("cleanup", t("lgDeleteDone", { n: r.deleted, size: formatSize(r.freedBytes, lang) || "0" }));
      if (r.backupPath) log.info("cleanup", t("lgBackup", { path: r.backupPath }));
      setNote(
        t("orphansDone", { n: r.deleted, size: formatSize(r.freedBytes, lang) || "0" }) +
          (r.failed.length ? ` ${t("doneFailed", { n: r.failed.length })} ${r.failed.map((f) => f.path).join(", ")}` : ""),
      );
      const gone = new Set(r.deletedItems.map((d) => d.path));
      setList((l) => l && l.filter((o) => !gone.has(o.path)));
      setChecked(new Set());
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  const date = (s: number) =>
    new Date(s * 1000).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <div className="commandbar">
        <button className="btn" onClick={scan} disabled={scanning || busy}>
          {scanning ? <Spinner /> : <Icon name="search" />}
          {t("orphansScan")}
        </button>
        <div className="spacer" />
        {list && list.length > 0 && (
          <button
            className="btn filled"
            disabled={selected.length === 0 || busy}
            onClick={() => setConfirm(true)}
          >
            {busy ? <Spinner /> : <Icon name="delete" />}
            {t("orphansDelete", { n: selected.length })}
          </button>
        )}
      </div>

      <div className="page-scroll">
        <div className="banner inline info">
          <Icon name="info" />
          <span>{t("orphansText")}</span>
        </div>
        {note && <div className="tweak-note">{note}</div>}
        {scanning ? (
          <div className="progress">
            <Spinner />
            <p className="dim">{t("orphansScanning")}</p>
          </div>
        ) : list === null ? null : list.length === 0 ? (
          <div className="progress dim">
            <Icon name="shield_ok" className="big" />
            <p>{t("orphansNone")}</p>
          </div>
        ) : (
          <div className="settings">
            {list.map((o) => (
              <label className="card-row tweak clean-row" key={o.path}>
                <input
                  type="checkbox"
                  checked={checked.has(o.path)}
                  disabled={busy}
                  onChange={() => toggle(o.path)}
                />
                <Icon name={o.kind === "regkey" ? "key" : "folder"} className="card-icon" />
                <div className="tweak-main">
                  <div className="row-name">{o.name}</div>
                  <div className="cmdline mono" title={o.path}>
                    {o.path}
                  </div>
                  <div className="row-sub">
                    {t(`root_${o.root}` as Key)} · {t("orphansModified", { date: date(o.modified) })}
                  </div>
                </div>
                <div className="clean-size">{o.sizeBytes ? formatSize(o.sizeBytes, lang) : ""}</div>
              </label>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <Confirm
          title={t("orphansConfirmTitle")}
          text={t("orphansConfirmText")}
          action={t("orphansDelete", { n: selected.length })}
          onCancel={() => setConfirm(false)}
          onOk={remove}
        />
      )}
    </>
  );
}

/** A small ContentDialog for "are you sure" questions. */
export function Confirm({
  title,
  text,
  action,
  onOk,
  onCancel,
}: {
  title: string;
  text: string;
  action: string;
  onOk: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="dialog-actions">
          <button className="btn text" onClick={onCancel}>
            {t("cancel")}
          </button>
          <button className="btn filled" autoFocus onClick={onOk}>
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
