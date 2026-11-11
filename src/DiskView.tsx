import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { formatSize, useI18n } from "./i18n";
import type { DiskItem, Drive, ExtStat, MapNode, ScanProgress, ScanResult } from "./types";
import {
  draw,
  extColors,
  FOLDER_COLOR,
  hitTest,
  layout,
  OTHER_EXT_COLOR,
  type Tile,
} from "./treemap";
import { Icon, Spinner } from "./ui";

type Phase = "start" | "scanning" | "result";
type Row = { item: DiskItem; depth: number; parentSize: number };

const ROW_H = 28;
const MAP_DEPTH = 16;
const MAP_MIN_FRAC = 1.5e-4;

const DRIVE_ICONS: Record<Drive["kind"], string> = {
  fixed: "hard_drive",
  removable: "usb",
  network: "lan",
  cdrom: "album",
  ram: "memory",
};

/** WinDirStat-like disk usage analyzer: folder tree, file types and a treemap. */
export default function DiskView({ dark }: { dark: boolean }) {
  const { t, lang } = useI18n();
  const size = useCallback((b: number) => (b > 0 ? formatSize(b, lang) : "0"), [lang]);
  const num = useCallback((n: number) => n.toLocaleString(lang), [lang]);

  const [phase, setPhase] = useState<Phase>("start");
  const [drives, setDrives] = useState<Drive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanPath, setScanPath] = useState("");
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const [root, setRoot] = useState<DiskItem | null>(null);
  const [kids, setKids] = useState<Map<number, DiskItem[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<DiskItem | null>(null);
  const [selChain, setSelChain] = useState<DiskItem[]>([]);
  const [selPath, setSelPath] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0);
  const [zoomChain, setZoomChain] = useState<DiskItem[]>([]);
  const [map, setMap] = useState<MapNode | null>(null);
  const [exts, setExts] = useState<ExtStat[]>([]);
  const [top, setTop] = useState<DiskItem[]>([]);
  const [side, setSide] = useState<"types" | "top">("types");
  const [hlExt, setHlExt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [confirm, setConfirm] = useState<{ item: DiskItem; permanent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const loadDrives = useCallback(() => {
    api
      .diskDrives()
      .then(setDrives)
      .catch(() => setDrives([]));
  }, []);
  useEffect(loadDrives, [loadDrives]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const loadChildren = useCallback(async (id: number) => {
    const c = await api.diskChildren(id);
    setKids((m) => new Map(m).set(id, c));
    return c;
  }, []);

  const selectItem = useCallback((item: DiskItem | null) => {
    setSelected(item);
    setSelPath(null);
    setSelChain([]);
    if (!item) return;
    api
      .diskAncestry(item.id)
      .then(setSelChain)
      .catch(() => {});
    if (item.kind !== 2)
      api
        .diskPath(item.id)
        .then(setSelPath)
        .catch(() => {});
  }, []);

  const startScan = useCallback(
    async (path: string) => {
      setPhase("scanning");
      setScanPath(path);
      setProgress(null);
      setError(null);
      const unlisten = await listen<ScanProgress>("disk-progress", (e) => setProgress(e.payload));
      try {
        const r = await api.diskScan(path);
        setResult(r);
        setRoot(r.root);
        setKids(new Map());
        setExpanded(new Set([0]));
        setZoom(0);
        setHlExt(null);
        setVersion((v) => v + 1);
        selectItem(r.root);
        await loadChildren(0);
        setPhase("result");
      } catch (e) {
        if (String(e) !== "superseded") {
          setError(String(e));
          setPhase("start");
        }
      } finally {
        unlisten();
      }
    },
    [loadChildren, selectItem],
  );

  const chooseFolder = async () => {
    const dir = await pickFolder({ directory: true, multiple: false });
    if (typeof dir === "string") startScan(dir);
  };

  // Data that depends on the whole tree: refreshed after a scan or a delete.
  useEffect(() => {
    if (phase !== "result") return;
    api
      .diskExtStats(0)
      .then(setExts)
      .catch(() => setExts([]));
    api
      .diskTopFiles(0, 200)
      .then(setTop)
      .catch(() => setTop([]));
  }, [phase, version]);

  useEffect(() => {
    if (phase !== "result") return;
    let alive = true;
    api
      .diskTreemap(zoom, MAP_DEPTH, MAP_MIN_FRAC)
      .then((m) => alive && setMap(m))
      .catch(() => alive && setMap(null));
    api
      .diskAncestry(zoom)
      .then((c) => alive && setZoomChain(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [phase, zoom, version]);

  const colors = useMemo(() => extColors(exts.map((e) => e.ext)), [exts]);
  const totalBytes = root?.size ?? 0;

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visit = (item: DiskItem, depth: number, parentSize: number) => {
      out.push({ item, depth, parentSize });
      if (!expanded.has(item.id)) return;
      for (const c of kids.get(item.id) ?? []) visit(c, depth + 1, item.size);
    };
    if (root) visit(root, 0, root.size);
    return out;
  }, [root, kids, expanded]);

  const toggle = useCallback(
    (item: DiskItem, open?: boolean) => {
      if (item.kind !== 0 || !item.hasChildren) return;
      const isOpen = expanded.has(item.id);
      const want = open ?? !isOpen;
      if (want === isOpen) return;
      if (want && !kids.has(item.id)) loadChildren(item.id).catch(() => {});
      setExpanded((s) => {
        const n = new Set(s);
        if (want) n.add(item.id);
        else n.delete(item.id);
        return n;
      });
    },
    [expanded, kids, loadChildren],
  );

  /** Select an item found on the map or in the side list: open the tree down to it. */
  const reveal = useCallback(
    async (id: number) => {
      const chain = await api.diskAncestry(id).catch(() => [] as DiskItem[]);
      if (!chain.length) return;
      const parents = chain.slice(0, -1);
      for (const p of parents) if (!kids.has(p.id)) await loadChildren(p.id).catch(() => {});
      setExpanded((s) => {
        const n = new Set(s);
        parents.forEach((p) => n.add(p.id));
        return n;
      });
      selectItem(chain[chain.length - 1]);
    },
    [kids, loadChildren, selectItem],
  );

  const doDelete = async () => {
    if (!confirm) return;
    const { item, permanent } = confirm;
    setBusy(true);
    try {
      const r = await api.diskDelete([item.id], permanent);
      if (r.failed.length) {
        setToast({ text: t("diskDeleteFailed", { error: r.failed[0].error }), error: true });
      } else {
        setToast({ text: t("diskDeleted", { size: size(r.freed) }) });
      }
      if (r.deleted > 0) {
        const parent = selChain.length > 1 ? selChain[selChain.length - 2] : null;
        if (zoomChain.some((z) => z.id === item.id)) setZoom(parent?.id ?? 0);
        // Reload every open folder: their sizes changed.
        const open = [...expanded].filter((id) => id !== item.id);
        const fresh = new Map<number, DiskItem[]>();
        await Promise.all(
          open.map((id) =>
            api
              .diskChildren(id)
              .then((c) => fresh.set(id, c))
              .catch(() => {}),
          ),
        );
        setKids(fresh);
        setExpanded(new Set(open));
        setRoot(await api.diskItem(0));
        selectItem(parent ? await api.diskItem(parent.id) : null);
        setVersion((v) => v + 1);
      }
    } catch (e) {
      setToast({ text: t("diskDeleteFailed", { error: String(e) }), error: true });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const canDelete = (it: DiskItem | null): it is DiskItem => !!it && it.kind !== 2 && it.id !== 0;

  // ---------------------------------------------------------------- start
  if (phase === "start") {
    return (
      <div className="disk-start">
        <div className="disk-hero">
          <div className="status-mark">
            <Icon name="donut_large" />
          </div>
          <h2>{t("diskTitle")}</h2>
          <p>{t("diskText")}</p>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="drives">
          {drives === null ? (
            <Spinner />
          ) : (
            drives.map((d) => {
              const used = d.total - d.free;
              const frac = d.total ? used / d.total : 0;
              return (
                <button key={d.path} className="drive" onClick={() => startScan(d.path)}>
                  <Icon name={DRIVE_ICONS[d.kind] ?? "hard_drive"} className="drive-icon" />
                  <div className="drive-main">
                    <div className="row-name">
                      {d.label ? `${d.label} (${d.path.slice(0, 2)})` : d.path.slice(0, 2)}
                    </div>
                    <div className={`meter ${frac > 0.9 ? "full" : ""}`}>
                      <div style={{ width: `${frac * 100}%` }} />
                    </div>
                    <div className="row-sub">
                      {t("diskFree", { free: size(d.free), total: size(d.total) })}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="disk-start-actions">
          <button className="btn tonal" onClick={chooseFolder}>
            <Icon name="folder_open" />
            {t("diskPickFolder")}
          </button>
          <button className="icon-btn" title={t("refresh")} onClick={loadDrives}>
            <Icon name="refresh" />
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- scanning
  if (phase === "scanning") {
    return (
      <div className="disk-start">
        <div className="progress">
          <Spinner />
          <h2>{t("diskScanning", { path: scanPath })}</h2>
          <p className="dim">
            {t("diskStats", {
              files: num(progress?.files ?? 0),
              dirs: num(progress?.dirs ?? 0),
              size: size(progress?.bytes ?? 0),
            })}
          </p>
          <div className="scan-current mono" title={progress?.current}>
            {progress?.current ?? ""}
          </div>
          <button className="btn tonal" onClick={() => api.diskCancel().catch(() => {})}>
            {t("diskStop")}
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- result
  return (
    <div className="disk">
      <div className="toolbar disk-bar">
        <div className="disk-bar-main">
          <button className="icon-btn" title={t("diskNew")} onClick={() => setPhase("start")}>
            <Icon name="arrow_back" />
          </button>
          <div>
            <div className="row-name">{result?.path}</div>
            <div className="row-sub">
              {t("diskSummary", {
                size: size(totalBytes),
                files: num(root?.files ?? 0),
                sec: (result?.seconds ?? 0).toFixed(1),
              })}
              {result?.free != null && ` · ${t("diskFreeSpace")}: ${size(result.free)}`}
            </div>
          </div>
        </div>
        <div className="summary">
          {result?.cancelled && (
            <span className="badge warn">
              <Icon name="warning" />
              {t("diskPartial")}
            </span>
          )}
          {!!result?.errors && (
            <span className="badge" title={t("notElevated")}>
              <Icon name="lock" />
              {t("diskErrors", { n: num(result.errors) })}
            </span>
          )}
          <button
            className="icon-btn"
            title={t("diskRescan")}
            onClick={() => result && startScan(result.path)}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      <div className="disk-panes">
        <DiskTree
          rows={rows}
          selected={selected}
          totalBytes={totalBytes}
          colors={colors}
          onSelect={selectItem}
          onToggle={toggle}
          onOpen={(it) => it.kind !== 2 && api.diskOpen(it.id).catch(() => {})}
          onDelete={(it, permanent) => canDelete(it) && setConfirm({ item: it, permanent })}
        />

        <aside className="disk-side">
          <div className="seg">
            <button className={side === "types" ? "on" : ""} onClick={() => setSide("types")}>
              {t("diskTypes")}
            </button>
            <button className={side === "top" ? "on" : ""} onClick={() => setSide("top")}>
              {t("diskTop")}
            </button>
          </div>
          <div className="disk-side-list">
            {side === "types"
              ? exts.slice(0, 300).map((e) => (
                  <div
                    key={e.ext}
                    className={`ext-row ${hlExt === e.ext ? "on" : ""}`}
                    onClick={() => setHlExt(hlExt === e.ext ? null : e.ext)}
                  >
                    <span
                      className="swatch"
                      style={{ background: colors.get(e.ext) ?? OTHER_EXT_COLOR }}
                    />
                    <span className="ext-name">{e.ext ? `.${e.ext}` : t("diskNoExt")}</span>
                    <span className="dim">{num(e.count)}</span>
                    <span className="ext-size">{size(e.bytes)}</span>
                    <span className="dim ext-pct">{pct(e.bytes, totalBytes)}</span>
                  </div>
                ))
              : top.map((f) => (
                  <div
                    key={f.id}
                    className={`ext-row ${selected?.id === f.id ? "on" : ""}`}
                    onClick={() => reveal(f.id)}
                    onDoubleClick={() => api.diskOpen(f.id).catch(() => {})}
                  >
                    <span
                      className="swatch"
                      style={{ background: colors.get(f.ext) ?? OTHER_EXT_COLOR }}
                    />
                    <span className="ext-name" title={f.name}>
                      {f.name}
                    </span>
                    <span className="ext-size">{size(f.size)}</span>
                  </div>
                ))}
          </div>
        </aside>
      </div>

      <div className="map-head">
        <button
          className="icon-btn small"
          title={t("diskZoomOut")}
          disabled={zoomChain.length < 2}
          onClick={() => setZoom(zoomChain[zoomChain.length - 2]?.id ?? 0)}
        >
          <Icon name="zoom_out" />
        </button>
        <div className="crumbs">
          {zoomChain.map((z, i) => (
            <button key={z.id} onClick={() => setZoom(z.id)} disabled={i === zoomChain.length - 1}>
              {z.name}
            </button>
          ))}
        </div>
        <span className="dim map-hint">{t("diskHint")}</span>
      </div>
      <Treemap
        map={map}
        colors={colors}
        selected={selected?.id ?? null}
        hlExt={hlExt}
        dark={dark}
        size={size}
        onSelect={(id) => reveal(id)}
        onZoom={(id) => setZoom(id)}
      />

      <div className="disk-actions">
        {selected ? (
          <>
            <span
              className="swatch"
              style={{
                background:
                  selected.kind === 1
                    ? (colors.get(selected.ext) ?? OTHER_EXT_COLOR)
                    : selected.kind === 2
                      ? OTHER_EXT_COLOR
                      : FOLDER_COLOR,
              }}
            />
            <div className="disk-sel">
              <div className="leftover-path" title={selPath ?? ""}>
                {selected.kind === 2
                  ? t("diskOther", { n: num(selected.files) })
                  : (selPath ?? selected.name)}
              </div>
              <div className="row-sub">
                {size(selected.size)}
                {selected.kind === 0 && ` · ${t("diskColFiles")}: ${num(selected.files)}`}
                {` · ${pct(selected.size, totalBytes)}`}
              </div>
            </div>
            {selected.kind !== 2 && (
              <>
                <button
                  className="icon-btn"
                  title={t("diskOpen")}
                  onClick={() => api.diskOpen(selected.id).catch(() => {})}
                >
                  <Icon name="open_in_new" />
                </button>
                <button
                  className="icon-btn"
                  title={t("diskReveal")}
                  onClick={() => api.diskReveal(selected.id).catch(() => {})}
                >
                  <Icon name="folder_open" />
                </button>
                <button
                  className="icon-btn"
                  title={t("diskCopy")}
                  onClick={() =>
                    selPath &&
                    navigator.clipboard
                      .writeText(selPath)
                      .then(() => setToast({ text: t("diskCopied") }))
                      .catch(() => {})
                  }
                >
                  <Icon name="content_copy" />
                </button>
              </>
            )}
            {canDelete(selected) && (
              <>
                <button
                  className="btn tonal compact"
                  onClick={() => setConfirm({ item: selected, permanent: false })}
                >
                  <Icon name="delete" />
                  {t("diskTrash")}
                </button>
                <button
                  className="icon-btn danger-icon"
                  title={t("diskDeleteForever")}
                  onClick={() => setConfirm({ item: selected, permanent: true })}
                >
                  <Icon name="delete_forever" />
                </button>
              </>
            )}
          </>
        ) : (
          <span className="dim">{t("diskSelectHint")}</span>
        )}
      </div>

      {toast && <div className={`snackbar ${toast.error ? "error" : ""}`}>{toast.text}</div>}

      {confirm && (
        <div
          className="scrim"
          onMouseDown={(e) => e.target === e.currentTarget && !busy && setConfirm(null)}
        >
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{t("diskConfirmTitle", { name: confirm.item.name })}</h2>
            <p>
              {t(confirm.permanent ? "diskConfirmForever" : "diskConfirmTrash", {
                size: size(confirm.item.size),
              })}
            </p>
            {selPath && <div className="note mono">{selPath}</div>}
            <div className="dialog-actions">
              <button className="btn text" disabled={busy} onClick={() => setConfirm(null)}>
                {t("cancel")}
              </button>
              <button
                className={`btn ${confirm.permanent ? "danger" : "filled"}`}
                disabled={busy}
                onClick={doDelete}
                autoFocus
              >
                {busy ? <Spinner /> : null}
                {confirm.permanent ? t("diskDeleteForever") : t("diskTrash")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return `${p >= 10 || p === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}

// ------------------------------------------------------------------- tree

function DiskTree(props: {
  rows: Row[];
  selected: DiskItem | null;
  totalBytes: number;
  colors: Map<string, string>;
  onSelect: (it: DiskItem) => void;
  onToggle: (it: DiskItem, open?: boolean) => void;
  onOpen: (it: DiskItem) => void;
  onDelete: (it: DiskItem, permanent: boolean) => void;
}) {
  const { rows, selected, colors, onSelect, onToggle, onOpen, onDelete } = props;
  const { t, lang } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selIndex = rows.findIndex((r) => r.item.id === selected?.id);

  // Keep the selected row in view.
  useEffect(() => {
    const el = ref.current;
    if (!el || selIndex < 0) return;
    const top = selIndex * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight;
  }, [selIndex, selected?.id]);

  const onKey = (e: React.KeyboardEvent) => {
    const cur = rows[selIndex];
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r) onSelect(r.item);
    };
    switch (e.key) {
      case "ArrowDown":
        go(selIndex + 1);
        break;
      case "ArrowUp":
        go(selIndex - 1);
        break;
      case "PageDown":
        go(selIndex + Math.floor(height / ROW_H));
        break;
      case "PageUp":
        go(selIndex - Math.floor(height / ROW_H));
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(rows.length - 1);
        break;
      case "ArrowRight":
        if (cur) onToggle(cur.item, true);
        break;
      case "ArrowLeft":
        if (!cur) break;
        if (cur.item.kind === 0 && cur.item.hasChildren && rows[selIndex + 1]?.depth > cur.depth) {
          onToggle(cur.item, false);
        } else {
          for (let i = selIndex - 1; i >= 0; i--) {
            if (rows[i].depth < cur.depth) {
              onSelect(rows[i].item);
              break;
            }
          }
        }
        break;
      case "Enter":
        if (cur) onOpen(cur.item);
        break;
      case "Delete":
        if (cur) onDelete(cur.item, e.shiftKey);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const first = Math.max(0, Math.floor(scroll / ROW_H) - 5);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW_H) + 5);
  const fmt = (b: number) => (b > 0 ? formatSize(b, lang) : "0");

  return (
    <div className="disk-tree">
      <div className="tree-head">
        <span className="c-name">{t("diskColName")}</span>
        <span className="c-share">{t("diskColShare")}</span>
        <span className="c-size">{t("diskColSize")}</span>
        <span className="c-files">{t("diskColFiles")}</span>
        <span className="c-date">{t("diskColModified")}</span>
      </div>
      <div
        className="tree-body"
        ref={ref}
        tabIndex={0}
        onKeyDown={onKey}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * ROW_H, position: "relative" }}>
          {rows.slice(first, last).map((r, i) => {
            const it = r.item;
            const open = rows[first + i + 1]?.depth > r.depth;
            const frac = r.parentSize ? it.size / r.parentSize : 0;
            const icon =
              it.kind === 0
                ? open
                  ? "folder_open"
                  : "folder"
                : it.kind === 2
                  ? "stacks"
                  : "draft";
            return (
              <div
                key={it.id}
                className={`tree-row ${selected?.id === it.id ? "sel" : ""}`}
                style={{ top: (first + i) * ROW_H }}
                onMouseDown={() => onSelect(it)}
                onDoubleClick={() => (it.kind === 0 ? onToggle(it) : onOpen(it))}
              >
                <span className="c-name" style={{ paddingLeft: r.depth * 16 }}>
                  <span
                    className="twisty"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onSelect(it);
                      onToggle(it);
                    }}
                  >
                    {it.kind === 0 && it.hasChildren && (
                      <Icon name={open ? "expand_more" : "chevron_right"} />
                    )}
                  </span>
                  <span
                    className="tree-icon"
                    style={
                      it.kind === 1 ? { color: colors.get(it.ext) ?? OTHER_EXT_COLOR } : undefined
                    }
                  >
                    <Icon name={icon} />
                  </span>
                  <span className="tree-name" title={it.name}>
                    {it.kind === 2 ? t("diskOther", { n: it.files.toLocaleString(lang) }) : it.name}
                  </span>
                </span>
                <span className="c-share">
                  <span className="share-bar">
                    <span style={{ width: `${Math.min(1, frac) * 100}%` }} />
                  </span>
                  <span className="share-pct">{pct(it.size, r.parentSize)}</span>
                </span>
                <span className="c-size">{fmt(it.size)}</span>
                <span className="c-files dim">
                  {it.kind === 1 ? "" : it.files.toLocaleString(lang)}
                </span>
                <span className="c-date dim">
                  {it.modified
                    ? new Date(it.modified * 1000).toLocaleDateString(lang, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- treemap

function Treemap(props: {
  map: MapNode | null;
  colors: Map<string, string>;
  selected: number | null;
  hlExt: string | null;
  dark: boolean;
  size: (b: number) => string;
  onSelect: (id: number) => void;
  onZoom: (id: number) => void;
}) {
  const { map, colors, selected, hlExt, dark, size, onSelect, onZoom } = props;
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [tip, setTip] = useState<{ x: number; y: number; tile: Tile } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiles = useMemo(
    () => (map && box.w > 0 && box.h > 0 ? layout(map, { x: 0, y: 0, w: box.w, h: box.h }) : []),
    [map, box],
  );

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(box.w * dpr);
    c.height = Math.round(box.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    draw(ctx, tiles, { colors, selected, highlightExt: hlExt, dark });
  }, [tiles, colors, selected, hlExt, dark, box]);

  const at = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y, tile: hitTest(tiles, x, y) };
  };

  /** The folder to zoom into: the top-level folder under the cursor. */
  const zoomTarget = (tile: Tile): number | null => {
    if (tile.depth === 0) return null;
    let best: Tile | null = null;
    for (const tt of tiles) {
      if (
        tt.depth === 1 &&
        tt.node.k === 0 &&
        tile.x >= tt.x &&
        tile.y >= tt.y &&
        tile.x < tt.x + tt.w &&
        tile.y < tt.y + tt.h
      )
        best = tt;
    }
    return best?.node.id ?? null;
  };

  return (
    <div className="treemap" ref={wrap}>
      <canvas
        ref={canvas}
        style={{ width: box.w, height: box.h }}
        onMouseMove={(e) => {
          const { x, y, tile } = at(e);
          setTip(tile ? { x, y, tile } : null);
        }}
        onMouseLeave={() => setTip(null)}
        onMouseDown={(e) => {
          const { tile } = at(e);
          if (tile) onSelect(tile.node.id);
        }}
        onDoubleClick={(e) => {
          const { tile } = at(e);
          const z = tile && zoomTarget(tile);
          if (z !== null && z !== undefined) onZoom(z);
        }}
      />
      {!map && (
        <div className="state">
          <Spinner />
        </div>
      )}
      {tip && (
        <div
          className="map-tip"
          style={{
            left: Math.min(tip.x + 14, box.w - 240),
            top: tip.y + 18 > box.h - 50 ? tip.y - 48 : tip.y + 18,
          }}
        >
          <div className="row-name">
            {tip.tile.node.k === 2 ? t("diskOther", { n: "…" }) : tip.tile.node.n}
          </div>
          <div className="row-sub">{size(tip.tile.node.s)}</div>
        </div>
      )}
    </div>
  );
}
