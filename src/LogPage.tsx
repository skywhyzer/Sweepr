import { useMemo, useState } from "react";
import { useI18n, type Key } from "./i18n";
import { log, useLog, type LogScope } from "./log";
import { LogView } from "./LogView";

const FILTERS: [string, Key, LogScope[] | null][] = [
  ["all", "logAll", null],
  ["uninstall", "logUninstall", ["uninstall", "updates"]],
  ["restore", "logRestore", ["restore", "backups"]],
  ["clean", "logClean", ["cleanup", "disk"]],
  ["repair", "logRepair", ["repair"]],
  ["drivers", "navDrivers", ["drivers"]],
  ["system", "logSystem", ["startup", "tweaks", "system"]],
];

/** Everything Sweepr has done, in one terminal. */
export default function LogPage() {
  const { t } = useI18n();
  const all = useLog();
  const [filter, setFilter] = useState("all");
  const scopes = FILTERS.find((f) => f[0] === filter)?.[2] ?? null;
  const shown = useMemo(
    () => (scopes ? all.filter((e) => scopes.includes(e.scope)) : all),
    [all, scopes],
  );

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{t("navLog")}</h1>
          <p>{t("logText")}</p>
        </div>
      </header>
      <div className="commandbar">
        <div className="seg" role="tablist">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              className={filter === id ? "on" : ""}
              onClick={() => setFilter(id)}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="dim">{t("logCount", { n: shown.length })}</span>
      </div>
      <div className="log-page-body">
        <LogView
          entries={shown}
          showScope
          title={t("logTitle")}
          empty={t("logEmpty")}
          onClear={() => log.clear()}
        />
      </div>
    </div>
  );
}
