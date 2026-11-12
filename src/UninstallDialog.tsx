import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { formatSize, useI18n, type Key } from "./i18n";
import type { AppInfo, DeleteReport, Leftover } from "./types";
import { AppIcon, Icon, Spinner } from "./ui";
import { getPref } from "./prefs";
import { log, useLog } from "./log";
import { LogView } from "./LogView";

type Phase =
  | "confirm"
  | "restorePoint"
  | "uninstalling"
  | "stuck"
  | "scanning"
  | "review"
  | "cleaning"
  | "done"
  | "error";

const KIND_ICON: Record<Leftover["kind"], string> = {
  dir: "folder",
  file: "draft",
  regkey: "key",
  regvalue: "data_object",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const itemKey = (l: Leftover) => `${l.kind}|${l.path}|${l.valueName ?? ""}`;
const isReg = (l: Leftover) => l.kind === "regkey" || l.kind === "regvalue";

function ItemInfo({ item }: { item: Leftover }) {
  const { t, lang } = useI18n();
  return (
    <>
      <Icon name={KIND_ICON[item.kind]} />
      <div className="leftover-main">
        <div className="leftover-path" title={item.path}>
          {item.path}
          {item.valueName ? ` → ${item.valueName}` : ""}
        </div>
        <div className="row-sub">
          {[t(`reason_${item.reason}` as Key), formatSize(item.sizeBytes, lang)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </>
  );
}

/** Files and registry entries as two titled groups. */
function Groups({
  items,
  render,
}: {
  items: Leftover[];
  render: (item: Leftover) => ReactNode;
}) {
  const { t } = useI18n();
  const groups: [Key, string, Leftover[]][] = [
    ["sectionFiles", "folder_open", items.filter((l) => !isReg(l))],
    ["sectionRegistry", "app_registration", items.filter(isReg)],
  ];
  return (
    <div className="leftovers">
      {groups.map(([title, icon, list]) => (
        <section key={title}>
          <div className="section-title">
            <Icon name={icon} />
            {t(title)}
            <span className="dim">
              {list.length ? list.length : `— ${t("sectionEmpty")}`}
            </span>
          </div>
          {list.map(render)}
        </section>
      ))}
    </div>
  );
}

export default function UninstallDialog({
  app,
  force,
  onClose,
}: {
  app: AppInfo;
  force: boolean;
  onClose: (changed: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [forced, setForced] = useState(force);
  const [gone, setGone] = useState(false);
  const [stuck, setStuck] = useState<{ code: number; missing: boolean }>({
    code: 0,
    missing: false,
  });
  const [error, setError] = useState("");
  const [found, setFound] = useState<Leftover[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [useTrash, setUseTrash] = useState(true);
  const [backupRegistry, setBackupRegistry] = useState(true);
  const [report, setReport] = useState<DeleteReport | null>(null);
  // Whether to make a restore point first: the Settings default, changeable here.
  const [makePoint, setMakePoint] = useState(() => getPref("autoRestore", true));
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  // Bumped whenever the flow moves on, so stale waits and polls stop.
  const run = useRef(0);
  const changed = useRef(false);
  const startMark = useRef(log.mark());
  const all = useLog();
  const mine = all.filter((e) => e.id >= startMark.current && e.scope === "uninstall");

  useEffect(() => () => void run.current++, []);
  // The terminal follows the work, then steps aside for the lists and results.
  useEffect(() => {
    setLogOpen(["restorePoint", "uninstalling", "scanning", "cleaning"].includes(phase));
  }, [phase]);
  useEffect(() => {
    api
      .isElevated()
      .then(setElevated)
      .catch(() => setElevated(false));
  }, []);

  const stillInstalled = () => api.isInstalled(app).catch(() => true);

  /** Find leftovers and show them; nothing is deleted here. */
  const scan = async (asForced: boolean) => {
    const id = ++run.current;
    changed.current = true;
    setForced(asForced);
    setPhase("scanning");
    log.cmd("uninstall", t("lgScan"));
    try {
      const list = await api.scanLeftovers(app);
      if (id !== run.current) return;
      if (!list.length) {
        log.ok("uninstall", t("lgScanNone"));
        return setPhase("done");
      }
      const regCount = list.filter(isReg).length;
      log.ok(
        "uninstall",
        t("lgScanDone", {
          n: list.length,
          files: list.length - regCount,
          reg: regCount,
          size: formatSize(
            list.reduce((sum, l) => sum + l.sizeBytes, 0),
            lang,
          ),
        }),
      );
      list.slice(0, 30).forEach((l) =>
        log.out(
          "uninstall",
          t("lgItem", {
            mark: t(l.confidence === "safe" ? "lgMarkSafe" : "lgMarkReview"),
            path: l.path + (l.valueName ? " → " + l.valueName : ""),
            reason: t(`reason_${l.reason}` as Key),
            size: formatSize(l.sizeBytes, lang) || "0",
          }),
        ),
      );
      if (list.length > 30) log.out("uninstall", t("lgMore", { n: list.length - 30 }));
      setFound(list);
      setChecked(new Set(list.filter((l) => l.confidence === "safe").map(itemKey)));
      setPhase("review");
    } catch (e) {
      log.err("uninstall", t("lgError", { error: String(e) }));
      setError(String(e));
      setPhase("error");
    }
  };

  const start = async () => {
    const before = ++run.current;
    log.info(
      "uninstall",
      t("lgStart", {
        name: app.name,
        kind: t(app.kind === "store" ? "lgKindStore" : "lgKindWin32"),
        version: app.version || "—",
      }),
    );
    if (forced) log.info("uninstall", t("lgForce"));
    // A restore point first, so even a broken uninstaller can be rolled back.
    // The user can skip it: here, or for good in Settings.
    if (!makePoint) {
      log.info("uninstall", t(getPref("autoRestore", true) ? "lgRpSkip" : "lgRpSkipSetting"));
    } else if (elevated === false) {
      log.warn("uninstall", t("lgRpFail", { error: t("optRestoreNoAdmin") }));
    } else {
      setPhase("restorePoint");
      const name = `Sweepr: ${app.name}`;
      log.cmd("uninstall", t("lgRpCreate", { name }));
      try {
        await api.createRestorePoint(name);
        log.ok("uninstall", t("lgRpOk"));
      } catch (e) {
        log.warn("uninstall", t("lgRpFail", { error: String(e) }));
      }
      if (before !== run.current) return;
    }
    if (forced) return scan(true);
    const id = ++run.current;
    changed.current = true;
    setGone(false);
    setPhase("uninstalling");

    // While the uninstaller window is open, notice when the program is
    // already gone so the user can move on without closing it first.
    (async () => {
      while (id === run.current) {
        await sleep(1500);
        if (id === run.current && !(await stillInstalled())) return setGone(true);
      }
    })();

    let code = 0;
    if (app.kind === "store") {
      log.cmd("uninstall", t("lgStoreRemove"));
      if (app.packageFullName) log.out("uninstall", app.packageFullName);
    } else {
      log.cmd("uninstall", t("lgRunUninstaller"));
      log.out("uninstall", app.quietUninstallString || app.uninstallString || "—");
    }
    try {
      // Resolves only when the uninstaller and all its child processes exit.
      code = await api.runUninstaller(app);
      log.info("uninstall", t("lgUninstallerExit", { code }));
    } catch (e) {
      if (id !== run.current) return;
      if (String(e).includes("UNINSTALLER_MISSING")) {
        log.err("uninstall", t("lgUninstallerMissing"));
        setStuck({ code: 0, missing: true });
        setPhase("stuck");
      } else {
        log.err("uninstall", t("lgError", { error: String(e) }));
        setError(`${t("uninstallFailed")}: ${e}`);
        setPhase("error");
      }
      return;
    }
    if (id !== run.current) return;
    if (!(await stillInstalled())) {
      log.ok("uninstall", t("lgGone"));
      if (id === run.current) scan(false);
      return;
    }
    if (id !== run.current) return;
    log.warn("uninstall", t("lgStillThere"));
    setStuck({ code, missing: false });
    setPhase("stuck");
    // An elevated uninstaller may still be working out of our sight.
    while (id === run.current) {
      await sleep(1500);
      if (id === run.current && !(await stillInstalled())) {
        if (id === run.current) scan(false);
        return;
      }
    }
  };

  const deleteChecked = async () => {
    const items = found.filter((l) => checked.has(itemKey(l)));
    if (!items.length) return setPhase("done");
    setPhase("cleaning");
    log.cmd(
      "uninstall",
      t("lgDelete", {
        n: items.length,
        how: t(useTrash ? "lgHowTrash" : "lgHowForever"),
        backup: t(backupRegistry ? "lgYes" : "lgNo"),
      }),
    );
    try {
      const r = await api.deleteLeftovers(items, useTrash, backupRegistry, app.name, null);
      r.failed.forEach((f) =>
        log.err("uninstall", t("lgDeleteFail", { path: f.path, error: f.error })),
      );
      log.ok(
        "uninstall",
        t("lgDeleteDone", { n: r.deleted, size: formatSize(r.freedBytes, lang) || "0" }),
      );
      if (r.backupPath) log.info("uninstall", t("lgBackup", { path: r.backupPath }));
      setReport(r);
      setPhase("done");
    } catch (e) {
      log.err("uninstall", t("lgError", { error: String(e) }));
      setError(String(e));
      setPhase("error");
    }
  };

  const toggle = (l: Leftover) =>
    setChecked((prev) => {
      const next = new Set(prev);
      const k = itemKey(l);
      if (!next.delete(k)) next.add(k);
      return next;
    });

  const selected = found.filter((l) => checked.has(itemKey(l)));
  const allChecked = found.length > 0 && selected.length === found.length;
  const selectedSize = selected.reduce((sum, l) => sum + l.sizeBytes, 0);
  const busy = phase === "scanning" || phase === "cleaning" || phase === "restorePoint";
  const close = () => {
    run.current++;
    onClose(changed.current);
  };

  const wide = phase === "review" || (phase === "done" && !!report?.deletedItems.length);

  return (
    <div
      className="scrim"
      onMouseDown={(e) =>
        e.target === e.currentTarget && !busy && phase !== "uninstalling" && close()
      }
    >
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="dialog-head">
          <AppIcon app={app} />
          <div>
            <div className="dialog-app">{app.name}</div>
            <div className="row-sub">
              {[app.publisher, app.version].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>

        {phase !== "confirm" && (
          <div className="log-dock">
            <button className="log-dock-head" onClick={() => setLogOpen((o) => !o)}>
              <Icon name={logOpen ? "expand_more" : "chevron_right"} />
              <Icon name="terminal" />
              {t(logOpen ? "logHide" : "logShow")}
            </button>
            {logOpen && <LogView compact entries={mine} live={busy || phase === "uninstalling"} />}
          </div>
        )}

        {phase === "confirm" && (
          <>
            <h2>{t(forced ? "confirmForceTitle" : "confirmTitle", { name: app.name })}</h2>
            <p>{t(forced ? "confirmForceText2" : "confirmText2")}</p>
            <div className="options">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={makePoint && elevated !== false}
                  disabled={elevated === false}
                  onChange={(e) => setMakePoint(e.target.checked)}
                />
                <span>{t("optRestorePoint")}</span>
              </label>
              <div className="row-sub wrap option-hint">
                {t(elevated === false ? "optRestoreNoAdmin" : "optRestorePointHint")}
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn text" onClick={close}>
                {t("cancel")}
              </button>
              <button className="btn danger" onClick={start} autoFocus>
                {t(forced ? "findTraces" : "uninstall")}
              </button>
            </div>
          </>
        )}

        {phase === "restorePoint" && (
          <div className="progress">
            <Spinner />
            <h2>{t("stepRestorePoint")}</h2>
            <p>{t("stepRestorePointHint")}</p>
          </div>
        )}

        {phase === "uninstalling" && (
          <>
            <div className="progress">
              <Spinner />
              <h2>{t("stepUninstall")}</h2>
              <p>{t(gone ? "goneWaiting" : "stepUninstallHint")}</p>
            </div>
            {gone && (
              <div className="dialog-actions">
                <button className="btn tonal" onClick={() => scan(false)}>
                  {t("continueNow")}
                </button>
              </div>
            )}
          </>
        )}

        {(phase === "scanning" || phase === "cleaning") && (
          <div className="progress">
            <Spinner />
            <h2>{t(phase === "scanning" ? "stepScan" : "stepClean")}</h2>
          </div>
        )}

        {phase === "stuck" && (
          <>
            <div className="status-head">
              <div className="status-mark warn">
                <Icon name="priority_high" />
              </div>
              <h2>{t("stuckTitle")}</h2>
            </div>
            <p>
              {stuck.missing
                ? t("stuckMissing")
                : stuck.code !== 0
                  ? t("stuckExit", { code: stuck.code })
                  : t("stuckQuiet")}
            </p>
            <div className="hint-card">
              <Icon name="bolt" />
              <span>{t("stuckHint")}</span>
            </div>
            <div className="dialog-actions">
              <button className="btn text" onClick={close}>
                {t("cancel")}
              </button>
              {!stuck.missing && (
                <button className="btn text" onClick={start}>
                  {t("retry")}
                </button>
              )}
              <button className="btn tonal" onClick={() => scan(true)}>
                {t("forceRemove")}
              </button>
            </div>
          </>
        )}

        {phase === "review" && (
          <>
            <h2>{t(forced ? "foundForceTitle" : "foundTitle", { n: found.length })}</h2>
            <p>{t("foundText")}</p>
            <label className="check-row head">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => setChecked(allChecked ? new Set() : new Set(found.map(itemKey)))}
              />
              <span>{t("selectAll")}</span>
              <span className="spacer" />
              <span className="dim">{formatSize(selectedSize, lang)}</span>
            </label>
            <Groups
              items={found}
              render={(l) => (
                <label className="check-row" key={itemKey(l)}>
                  <input
                    type="checkbox"
                    checked={checked.has(itemKey(l))}
                    onChange={() => toggle(l)}
                  />
                  <ItemInfo item={l} />
                  {l.confidence !== "safe" && <span className="badge">{t("unsure")}</span>}
                </label>
              )}
            />
            <div className="options">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={useTrash}
                  onChange={(e) => setUseTrash(e.target.checked)}
                />
                <span>{t("optTrash")}</span>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={backupRegistry}
                  onChange={(e) => setBackupRegistry(e.target.checked)}
                />
                <span>{t("optBackup")}</span>
              </label>
            </div>
            <div className="dialog-actions">
              <button
                className="btn text"
                onClick={() => {
                  log.info("uninstall", t("lgKept"));
                  setPhase("done");
                }}
              >
                {t("keepAll")}
              </button>
              <button
                className="btn danger"
                disabled={selected.length === 0}
                onClick={deleteChecked}
              >
                {t("deleteSelected", { n: selected.length })}
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <div className="status-head">
              <div className="status-mark ok">
                <Icon name="check" />
              </div>
              <div>
                <h2>
                  {forced && !report
                    ? t("nothingDeleted")
                    : t("doneTitle", { name: app.name })}
                </h2>
                <p>
                  {report
                    ? [
                        t("doneRemoved", { n: report.deleted }),
                        report.freedBytes > 0
                          ? t("doneFreed", { size: formatSize(report.freedBytes, lang) })
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : found.length
                      ? t("doneKept")
                      : forced
                        ? t("nothingFound")
                        : t("doneClean")}
                </p>
              </div>
            </div>
            {report && report.deletedItems.length > 0 && (
              <>
                <div className="section-title plain">{t("doneDeleted")}</div>
                <Groups
                  items={report.deletedItems}
                  render={(l) => (
                    <div className="check-row plain" key={itemKey(l)}>
                      <ItemInfo item={l} />
                    </div>
                  )}
                />
              </>
            )}
            {report && report.failed.length > 0 && (
              <div className="failed">
                <div className="failed-title">
                  <Icon name="warning" />
                  {t("doneFailed", { n: report.failed.length })}
                </div>
                {report.failed.map((f) => (
                  <div className="leftover-path" key={f.path} title={f.error}>
                    {f.path}
                  </div>
                ))}
              </div>
            )}
            {report?.backupPath && (
              <p className="note">
                <Icon name="history" />
                {t("doneBackup")}
              </p>
            )}
            <div className="dialog-actions">
              <button className="btn filled" onClick={close} autoFocus>
                {t("done")}
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <h2>{t("errorTitle")}</h2>
            <p className="error-text">{error}</p>
            <div className="dialog-actions">
              <button className="btn text" onClick={close}>
                {t("close")}
              </button>
              <button className="btn tonal" onClick={() => scan(true)}>
                {t("forceRemove")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
