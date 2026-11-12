import { useEffect, useLayoutEffect, useRef } from "react";
import { useI18n } from "./i18n";
import { entriesToText, formatTime, type LogEntry, type LogLevel } from "./log";
import { Icon } from "./ui";

const GLYPH: Record<LogLevel, string> = {
  info: "•",
  ok: "✔",
  warn: "▲",
  err: "✖",
  cmd: "❯",
  out: " ",
};

/**
 * A terminal window in the style of the new Windows Terminal: a tab strip on
 * top, Campbell colours, Cascadia Mono, a blinking block cursor while the
 * operation runs. It always stays dark, like a real terminal, so it reads the
 * same on the light and the dark theme.
 */
export function LogView({
  entries,
  title = "Sweepr",
  live = false,
  showScope = false,
  empty,
  className = "",
  compact = false,
  onClear,
}: {
  entries: LogEntry[];
  title?: string;
  /** An operation is running: show the cursor and keep following the end. */
  live?: boolean;
  showScope?: boolean;
  empty?: string;
  className?: string;
  /** Hide the tab strip (used where the surrounding UI already has a heading). */
  compact?: boolean;
  onClear?: () => void;
}) {
  const { t } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow new lines unless the user has scrolled up to read.
  useLayoutEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, live]);

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const copy = () => {
    navigator.clipboard.writeText(entriesToText(entries)).catch(() => {});
  };

  return (
    <div className={`term ${compact ? "compact" : ""} ${className}`}>
      {!compact && (
        <div className="term-bar">
          <div className="term-tab">
            <Icon name="terminal" />
            <span>{title}</span>
          </div>
          <div className="spacer" />
          <button className="term-act" title={t("logCopy")} onClick={copy} disabled={!entries.length}>
            <Icon name="content_copy" />
          </button>
          {onClear && (
            <button
              className="term-act"
              title={t("logClear")}
              onClick={onClear}
              disabled={!entries.length}
            >
              <Icon name="delete" />
            </button>
          )}
        </div>
      )}
      <div
        className="term-body"
        ref={body}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {entries.length === 0 && empty && <div className="term-empty">{empty}</div>}
        {entries.map((e) => (
          <div className={`term-line lvl-${e.level}`} key={e.id}>
            <span className="term-time">{e.time ? formatTime(e.time) : ""}</span>
            {showScope && <span className={`term-scope sc-${e.scope}`}>{e.scope}</span>}
            <span className="term-glyph">{GLYPH[e.level]}</span>
            <span className="term-text">{e.text}</span>
          </div>
        ))}
        {live && (
          <div className="term-line">
            <span className="term-time" />
            <span className="term-glyph lvl-cmd">❯</span>
            <span className="term-cursor" />
          </div>
        )}
      </div>
    </div>
  );
}
