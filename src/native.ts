import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Everything that makes the WebView behave like an app window rather than a
 * browser tab: no page context menu, no reload / print / find / navigation
 * shortcuts, no dragging images out, and the Windows accent colour and Mica
 * backdrop instead of a palette of our own.
 */

interface SystemLook {
  build: number;
  accentLight: string | null;
  accentDark: string | null;
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || el.closest("input, textarea, [contenteditable]") !== null);

function blockBrowserBehaviour() {
  // The WebView menu offers Back / Reload / Print / Inspect. Keep it only
  // where it is useful: in text fields and over selected text (Copy).
  window.addEventListener("contextmenu", (e) => {
    const selected = (window.getSelection()?.toString() ?? "").length > 0;
    if (!isEditable(e.target) && !selected) e.preventDefault();
  });

  window.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const blocked =
        k === "f5" ||
        k === "f7" || // caret browsing
        k === "browserback" ||
        k === "browserforward" ||
        k === "browserrefresh" ||
        (e.altKey && (k === "arrowleft" || k === "arrowright")) ||
        (ctrl && ["r", "p", "s", "u", "o", "n", "g", "h", "j"].includes(k)) ||
        // Ctrl+F opens the WebView find bar; the app handles it itself.
        (ctrl && k === "f");
      if (blocked) e.preventDefault();
    },
    true,
  );

  // Mouse back / forward buttons would navigate the page.
  window.addEventListener("mouseup", (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });

  window.addEventListener("dragstart", (e) => {
    if (!isEditable(e.target)) e.preventDefault();
  });

  // Middle-click autoscroll is a browser thing.
  window.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
}

async function applySystemLook() {
  const root = document.documentElement;
  try {
    const look = await invoke<SystemLook>("system_look");
    if (look.accentLight) root.style.setProperty("--accent-light", look.accentLight);
    if (look.accentDark) root.style.setProperty("--accent-dark", look.accentDark);
    // Mica is a Windows 11 feature; on Windows 10 the window keeps a solid fill.
    if (look.build >= 22000) root.dataset.mica = "";
  } catch {
    // Not running inside Tauri (plain `vite` in a browser): keep the defaults.
  }
}

/** Runs before the first render. */
export async function prepareWindow() {
  blockBrowserBehaviour();
  await applySystemLook();
}

/** Called once React has painted, so the window never shows up blank. */
export function revealWindow() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      getCurrentWindow()
        .show()
        .catch(() => {});
    }),
  );
}
