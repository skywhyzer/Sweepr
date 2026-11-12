import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatSize, useI18n, type Key } from "./i18n";
import { log, useLog } from "./log";
import { LogView } from "./LogView";
import { getPref } from "./prefs";
import type { DriverInfo, DriverUpdate } from "./types";
import { Icon, Skeleton, Spinner } from "./ui";

type Tab = "updates" | "installed" | "problems";
type Show = "main" | "thirdParty" | "all";

/** Device classes people care about; the rest (system, volumes…) hide under "All". */
const MAIN = new Set([
  "DISPLAY",
  "NET",
  "MEDIA",
  "AUDIOENDPOINT",
  "BLUETOOTH",
  "USB",
  "CAMERA",
  "IMAGE",
  "PRINTER",
  "MONITOR",
  "HDC",
  "SCSIADAPTER",
  "BIOMETRIC",
  "FIRMWARE",
  "KEYBOARD",
  "MOUSE",
]);

const CLASS_RU: Record<string, string> = {
  DISPLAY: "Видеоадаптеры",
  NET: "Сетевые адаптеры",
  MEDIA: "Звук, видео и игры",
  AUDIOENDPOINT: "Аудиовходы и выходы",
  BLUETOOTH: "Bluetooth",
  USB: "Контроллеры USB",
  HIDCLASS: "Устройства ввода (HID)",
  KEYBOARD: "Клавиатуры",
  MOUSE: "Мыши",
  MONITOR: "Мониторы",
  CAMERA: "Камеры",
  IMAGE: "Камеры и сканеры",
  PRINTER: "Принтеры",
  PRINTQUEUE: "Очереди печати",
  DISKDRIVE: "Дисковые устройства",
  SCSIADAPTER: "Контроллеры хранения",
  HDC: "Контроллеры IDE/SATA",
  PROCESSOR: "Процессоры",
  SYSTEM: "Системные устройства",
  SOFTWAREDEVICE: "Программные устройства",
  SOFTWARECOMPONENT: "Программные компоненты",
  VOLUME: "Тома",
  VOLUMESNAPSHOT: "Теневые копии томов",
  BIOMETRIC: "Биометрия",
  BATTERY: "Батареи",
  FIRMWARE: "Встроенное ПО",
  SECURITYDEVICES: "Устройства безопасности",
  COMPUTER: "Компьютер",
  OTHERHARDWARE: "Другие устройства",
};

const CLASS_EN: Record<string, string> = {
  DISPLAY: "Display adapters",
  NET: "Network adapters",
  MEDIA: "Sound, video and game controllers",
  AUDIOENDPOINT: "Audio inputs and outputs",
  BLUETOOTH: "Bluetooth",
  USB: "USB controllers",
  HIDCLASS: "Human interface devices",
  KEYBOARD: "Keyboards",
  MOUSE: "Mice",
  MONITOR: "Monitors",
  CAMERA: "Cameras",
  IMAGE: "Imaging devices",
  PRINTER: "Printers",
  PRINTQUEUE: "Print queues",
  DISKDRIVE: "Disk drives",
  SCSIADAPTER: "Storage controllers",
  HDC: "IDE/SATA controllers",
  PROCESSOR: "Processors",
  SYSTEM: "System devices",
  SOFTWAREDEVICE: "Software devices",
  SOFTWARECOMPONENT: "Software components",
  VOLUME: "Volumes",
  VOLUMESNAPSHOT: "Volume shadow copies",
  BIOMETRIC: "Biometric devices",
  BATTERY: "Batteries",
  FIRMWARE: "Firmware",
  SECURITYDEVICES: "Security devices",
  COMPUTER: "Computer",
  OTHERHARDWARE: "Other devices",
};

const CLASS_ICON: Record<string, string> = {
  DISPLAY: "desktop",
  MONITOR: "desktop",
  NET: "wifi",
  MEDIA: "speaker",
  AUDIOENDPOINT: "speaker",
  BLUETOOTH: "bluetooth",
  USB: "usb",
  HIDCLASS: "keyboard",
  KEYBOARD: "keyboard",
  MOUSE: "keyboard",
  CAMERA: "camera",
  IMAGE: "camera",
  PRINTER: "print",
  PRINTQUEUE: "print",
  DISKDRIVE: "hard_drive",
  SCSIADAPTER: "hard_drive",
  HDC: "hard_drive",
  VOLUME: "hard_drive",
};

/** Device Manager problem codes, in words. */
const PROBLEMS: Record<number, [string, string]> = {
  1: ["Устройство настроено неправильно", "The device is not configured correctly"],
  3: ["Драйвер повреждён или системе не хватает памяти", "The driver may be corrupted, or the system is low on memory"],
  10: ["Устройство не запускается", "The device cannot start"],
  12: ["Устройству не хватает свободных ресурсов", "Not enough free resources for this device"],
  14: ["Нужна перезагрузка", "A restart is needed"],
  18: ["Нужно переустановить драйвер", "The driver needs to be reinstalled"],
  19: ["Повреждены настройки устройства в реестре", "The device's registry settings are damaged"],
  21: ["Устройство удаляется", "The device is being removed"],
  22: ["Устройство отключено", "The device is disabled"],
  24: ["Устройство отсутствует или работает неправильно", "The device is missing or not working properly"],
  28: ["Драйвер не установлен", "No driver is installed"],
  31: ["Windows не может загрузить драйвер", "Windows cannot load the driver"],
  37: ["Драйвер вернул ошибку", "The driver returned a failure"],
  39: ["Драйвер повреждён или отсутствует", "The driver is corrupted or missing"],
  43: ["Устройство сообщило о сбое", "The device reported a problem"],
  45: ["Устройство не подключено", "The device is not connected"],
  52: ["Цифровая подпись драйвера не проверена", "The driver's digital signature could not be verified"],
};

const year = 365 * 86400;

export default function DriversPage({
  elevated,
  onRestartAdmin,
}: {
  elevated: boolean;
  onRestartAdmin: () => void;
}) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>("updates");
  const [drivers, setDrivers] = useState<DriverInfo[] | null>(null);
  const [driversErr, setDriversErr] = useState<string | null>(null);

  const loadDrivers = () => {
    setDrivers(null);
    setDriversErr(null);
    log.cmd("drivers", t("lgDrvList"));
    api
      .listDrivers()
      .then((d) => {
        const third = d.filter((x) => x.provider && !/microsoft/i.test(x.provider)).length;
        const bad = d.filter((x) => x.problem !== 0);
        log.ok("drivers", t("lgDrvListDone", { n: d.length, third, bad: bad.length }));
        bad.forEach((x) => log.warn("drivers", `${x.device}: ${problemText(x.problem, lang)}`));
        setDrivers(d);
      })
      .catch((e) => {
        log.err("drivers", t("lgError", { error: String(e) }));
        setDriversErr(String(e));
        setDrivers([]);
      });
  };
  useEffect(loadDrivers, []);

  const problems = (drivers ?? []).filter((d) => d.problem !== 0);
  const tabs: [Tab, string][] = [
    ["updates", t("drvTabUpdates")],
    ["installed", t("drvTabInstalled")],
    ["problems", problems.length ? t("drvTabProblemsN", { n: problems.length }) : t("drvTabProblems")],
  ];

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{t("navDrivers")}</h1>
          <p>{t("drvText")}</p>
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
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => api.openDeviceManager().catch(() => {})}>
          <Icon name="developer_board" />
          {t("drvDevMgr")}
        </button>
      </div>
      {tab === "updates" && <Updates elevated={elevated} onRestartAdmin={onRestartAdmin} />}
      {tab === "installed" && (
        <Installed drivers={drivers} error={driversErr} onReload={loadDrivers} />
      )}
      {tab === "problems" && <Problems drivers={drivers} onReload={loadDrivers} />}
    </div>
  );
}

function problemText(code: number, lang: string): string {
  const p = PROBLEMS[code];
  const text = p ? p[lang === "ru" ? 0 : 1] : lang === "ru" ? "Неизвестная проблема" : "Unknown problem";
  return `${text} (${lang === "ru" ? "код" : "code"} ${code})`;
}

function classLabel(cls: string, lang: string): string {
  const k = cls.toUpperCase();
  return (lang === "ru" ? CLASS_RU : CLASS_EN)[k] ?? cls;
}

function fmtDate(sec: number, lang: string): string {
  // Windows reports "no date" as 1 January 1970 in local time.
  if (sec < 86400 * 2) return "";
  return new Date(sec * 1000).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
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

// ----------------------------------------------------------------- updates

function Updates({ elevated, onRestartAdmin }: { elevated: boolean; onRestartAdmin: () => void }) {
  const { t, lang } = useI18n();
  const [list, setList] = useState<DriverUpdate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"scan" | "install" | "export" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [makePoint, setMakePoint] = useState(() => getPref("autoRestore", true));
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [reboot, setReboot] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const all = useLog();
  const mine = useMemo(() => all.filter((e) => e.scope === "drivers").slice(-200), [all]);

  const scan = async () => {
    setBusy("scan");
    setNote(null);
    setResults({});
    log.cmd("drivers", t("lgDrvScan"));
    try {
      const u = await api.scanDriverUpdates();
      if (u.length) {
        log.ok("drivers", t("lgDrvScanDone", { n: u.length }));
        u.forEach((x) =>
          log.out(
            "drivers",
            `${x.model || x.title} — ${x.manufacturer}${x.date > 86400 * 2 ? ", " + fmtDate(x.date, lang) : ""}${x.sizeBytes ? ", " + formatSize(x.sizeBytes, lang) : ""}`,
          ),
        );
      } else {
        log.ok("drivers", t("lgDrvScanNone"));
      }
      setList(u);
      setPicked(new Set(u.map((x) => x.id)));
    } catch (e) {
      log.err("drivers", t("lgError", { error: String(e) }));
      setNote({ text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const install = async () => {
    setConfirm(false);
    const chosen = (list ?? []).filter((u) => picked.has(u.id));
    if (!chosen.length) return;
    setBusy("install");
    setNote(null);
    if (makePoint) {
      const name = t("drvPointName");
      log.cmd("drivers", t("lgRpCreate", { name }));
      try {
        await api.createRestorePoint(name);
        log.ok("drivers", t("lgRpOk"));
      } catch (e) {
        log.warn("drivers", t("lgRpFail", { error: String(e) }));
      }
    } else {
      log.info("drivers", t("lgRpSkip"));
    }
    log.cmd("drivers", t("lgDrvInstall", { n: chosen.length }));
    try {
      const r = await api.installDriverUpdates(chosen.map((u) => u.id));
      const done: Record<string, boolean> = {};
      for (const it of r.items) {
        const ok = it.code === 2 || it.code === 3;
        done[it.id] = ok;
        if (ok) log.ok("drivers", t("lgDrvInstalled", { name: it.title }));
        else
          log.err(
            "drivers",
            t("lgDrvInstallFail", { name: it.title, code: `0x${(it.hresult >>> 0).toString(16)}` }),
          );
      }
      setResults(done);
      if (r.reboot) {
        log.warn("drivers", t("lgRepairReboot"));
        setReboot(true);
      }
      const okCount = Object.values(done).filter(Boolean).length;
      setNote({ text: t("drvInstallDone", { n: okCount, total: chosen.length }), error: okCount < chosen.length });
    } catch (e) {
      log.err("drivers", t("lgError", { error: String(e) }));
      setNote({ text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const exportAll = async () => {
    setBusy("export");
    setNote(null);
    log.cmd("drivers", t("lgDrvExport"));
    log.out("drivers", "pnputil /export-driver *");
    try {
      const r = await api.exportDrivers();
      if (r.output) log.out("drivers", r.output);
      log.ok("drivers", t("lgDrvExported", { folder: r.folder }));
      setNote({ text: t("lgDrvExported", { folder: r.folder }), error: false });
      api.openLocation(r.folder).catch(() => {});
    } catch (e) {
      log.err("drivers", t("lgError", { error: String(e) }));
      setNote({ text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const allPicked = !!list?.length && picked.size === list.length;

  return (
    <>
      <div className="commandbar">
        <button className="btn filled" disabled={busy !== null} onClick={scan}>
          {busy === "scan" ? <Spinner /> : <Icon name="search" />}
          {busy === "scan" ? t("drvScanning") : t("drvScan")}
        </button>
        {!!list?.length && (
          <button
            className="btn"
            disabled={busy !== null || picked.size === 0 || !elevated}
            onClick={() => setConfirm(true)}
          >
            {busy === "install" ? <Spinner /> : <Icon name="update" />}
            {busy === "install" ? t("drvInstalling") : t("drvInstallN", { n: picked.size })}
          </button>
        )}
        <div className="spacer" />
        <button className="btn" disabled={busy !== null || !elevated} onClick={exportAll}>
          {busy === "export" ? <Spinner /> : <Icon name="save" />}
          {t("drvExport")}
        </button>
      </div>
      <div className="page-scroll">
        {!elevated && <AdminBar text={t("drvNeedAdmin")} onRestartAdmin={onRestartAdmin} />}
        {reboot && (
          <div className="banner inline">
            <Icon name="refresh" />
            <span>{t("drvReboot")}</span>
          </div>
        )}
        {note && <div className={note.error ? "backup-error" : "tweak-note"}>{note.text}</div>}
        <p className="tweak-note">{t("drvUpdHint")}</p>

        {(mine.length > 0 || busy !== null) && (
          <div className="log-block top">
            <LogView entries={mine} title={t("navDrivers")} live={busy !== null} />
          </div>
        )}

        {busy === "scan" && !list ? (
          <Skeleton rows={4} label={t("drvScanningHint")} />
        ) : list === null ? (
          <div className="progress dim">
            <Icon name="update" className="big" />
            <p>{t("drvStart")}</p>
          </div>
        ) : list.length === 0 ? (
          <div className="progress dim">
            <Icon name="shield_ok" className="big" />
            <p>{t("drvUpToDate")}</p>
          </div>
        ) : (
          <div className="settings">
            <label className="check-row point-all">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() => setPicked(allPicked ? new Set() : new Set(list.map((u) => u.id)))}
              />
              <span>{t("rpSelectAll")}</span>
            </label>
            {list.map((u) => {
              const res = results[u.id];
              return (
                <label className={`card-row tweak ${picked.has(u.id) ? "picked" : ""}`} key={u.id}>
                  <input
                    type="checkbox"
                    className="point-check"
                    checked={picked.has(u.id)}
                    disabled={busy !== null}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (!n.delete(u.id)) n.add(u.id);
                        return n;
                      })
                    }
                  />
                  <Icon name="developer_board" className="card-icon" />
                  <div className="tweak-main">
                    <div className="row-name">{u.model || u.title}</div>
                    <div className="row-sub wrap">
                      {[u.manufacturer, fmtDate(u.date, lang), u.sizeBytes ? formatSize(u.sizeBytes, lang) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {u.model && u.title !== u.model && <div className="row-sub wrap dim">{u.title}</div>}
                    {res !== undefined && (
                      <div className="tweak-tags">
                        <span className={`badge ${res ? "ok-soft" : "danger"}`}>
                          <Icon name={res ? "check" : "warning"} />
                          {res ? t("drvOk") : t("drvFail")}
                        </span>
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {confirm && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{t("drvConfirmTitle", { n: picked.size })}</h2>
            <p>{t("drvConfirmText")}</p>
            <div className="options">
              <label className="check-row">
                <input type="checkbox" checked={makePoint} onChange={(e) => setMakePoint(e.target.checked)} />
                <span>{t("drvConfirmPoint")}</span>
              </label>
            </div>
            <div className="dialog-actions">
              <button className="btn text" onClick={() => setConfirm(false)}>
                {t("cancel")}
              </button>
              <button className="btn filled" onClick={install} autoFocus>
                {t("drvInstallN", { n: picked.size })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------- installed

function Installed({
  drivers,
  error,
  onReload,
}: {
  drivers: DriverInfo[] | null;
  error: string | null;
  onReload: () => void;
}) {
  const { t, lang } = useI18n();
  const [show, setShow] = useState<Show>("main");
  const [query, setQuery] = useState("");
  const now = Date.now() / 1000;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (drivers ?? []).filter((d) => {
      if (show === "main" && !MAIN.has(d.class.toUpperCase()) && d.problem === 0) return false;
      if (show === "thirdParty" && (!d.provider || /microsoft/i.test(d.provider))) return false;
      if (q && !`${d.device} ${d.provider} ${d.manufacturer} ${d.version}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const map = new Map<string, DriverInfo[]>();
    for (const d of list) {
      const k = classLabel(d.class || "OtherHardware", lang);
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], lang));
  }, [drivers, show, query, lang]);

  const shows: [Show, Key][] = [
    ["main", "drvShowMain"],
    ["thirdParty", "drvShowThird"],
    ["all", "drvShowAll"],
  ];

  return (
    <>
      <div className="commandbar">
        <div className="seg" role="tablist">
          {shows.map(([id, label]) => (
            <button key={id} className={show === id ? "on" : ""} onClick={() => setShow(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        <label className="search drv-search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("drvSearch")}
            spellCheck={false}
          />
        </label>
        <div className="spacer" />
        <button className="icon-btn" title={t("refresh")} onClick={onReload} disabled={drivers === null}>
          <Icon name="refresh" />
        </button>
      </div>
      <div className="page-scroll">
        {error && <div className="backup-error">{error}</div>}
        {drivers === null ? (
          <Skeleton rows={7} label={t("drvLoading")} />
        ) : groups.length === 0 ? (
          <div className="progress dim">
            <Icon name="search_off" className="big" />
            <p>{t("empty")}</p>
          </div>
        ) : (
          <div className="settings">
            {groups.map(([label, list]) => (
              <section key={label}>
                <h3 className="tweak-cat">
                  {label} <span className="dim">{list.length}</span>
                </h3>
                {list.map((d) => (
                  <div className="card-row tweak" key={d.deviceId} title={d.deviceId}>
                    <Icon name={CLASS_ICON[d.class.toUpperCase()] ?? "developer_board"} className="card-icon" />
                    <div className="tweak-main">
                      <div className="row-name">{d.device}</div>
                      <div className="row-sub wrap">
                        {[d.provider || d.manufacturer, d.version, fmtDate(d.date, lang), d.inf]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {(d.problem !== 0 || (!d.signed && d.version) || (d.date > 86400 * 2 && now - d.date > 6 * year)) && (
                        <div className="tweak-tags">
                          {d.problem !== 0 && (
                            <span className="badge danger">
                              <Icon name="warning" />
                              {problemText(d.problem, lang)}
                            </span>
                          )}
                          {!d.signed && d.version && <span className="badge warn">{t("drvUnsigned")}</span>}
                          {d.date > 86400 * 2 && now - d.date > 6 * year && (
                            <span className="badge">{t("drvOld")}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- problems

function Problems({ drivers, onReload }: { drivers: DriverInfo[] | null; onReload: () => void }) {
  const { t, lang } = useI18n();
  const list = (drivers ?? []).filter((d) => d.problem !== 0);
  return (
    <>
      <div className="commandbar">
        <div className="spacer" />
        <button className="icon-btn" title={t("refresh")} onClick={onReload} disabled={drivers === null}>
          <Icon name="refresh" />
        </button>
      </div>
      <div className="page-scroll">
        <p className="tweak-note">{t("drvProblemsHint")}</p>
        {drivers === null ? (
          <Skeleton rows={3} />
        ) : list.length === 0 ? (
          <div className="progress dim">
            <Icon name="shield_ok" className="big" />
            <p>{t("drvNoProblems")}</p>
          </div>
        ) : (
          <div className="settings">
            {list.map((d) => (
              <div className="card-row tweak" key={d.deviceId}>
                <Icon name="warning" className="card-icon warn-icon" />
                <div className="tweak-main">
                  <div className="row-name">{d.device}</div>
                  <div className="row-sub wrap">{problemText(d.problem, lang)}</div>
                  <div className="row-sub wrap mono dim">{d.deviceId}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
