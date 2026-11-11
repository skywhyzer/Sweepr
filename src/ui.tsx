import { useEffect, useState } from "react";
import { loadIcon } from "./api";
import type { AppInfo } from "./types";

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-rounded ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

const AVATAR_HUES = [217, 4, 45, 136, 291, 187, 26, 262];

/** Program icon; falls back to a coloured letter while loading or when missing. */
export function AppIcon({ app }: { app: AppInfo }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (app.iconPath) {
      loadIcon(app.iconPath).then((s) => {
        if (alive) setSrc(s);
      });
    }
    return () => {
      alive = false;
    };
  }, [app.iconPath]);

  if (src) return <img className="app-icon" src={src} alt="" draggable={false} />;

  const letter = (app.name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const ch of app.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  return (
    <div className="app-icon avatar" style={{ ["--hue" as string]: hue }}>
      {letter}
    </div>
  );
}

export function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 48 48" role="progressbar">
      <circle cx="24" cy="24" r="18" fill="none" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
