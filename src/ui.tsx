import { useEffect, useState } from "react";
import { loadIcon } from "./api";
import type { AppInfo } from "./types";
import i_apps from "@fluentui/svg-icons/icons/apps_20_regular.svg?raw";
import i_arrow_clockwise from "@fluentui/svg-icons/icons/arrow_clockwise_20_regular.svg?raw";
import i_arrow_left from "@fluentui/svg-icons/icons/arrow_left_20_regular.svg?raw";
import i_arrow_undo from "@fluentui/svg-icons/icons/arrow_undo_20_regular.svg?raw";
import i_braces from "@fluentui/svg-icons/icons/braces_20_regular.svg?raw";
import i_broom from "@fluentui/svg-icons/icons/broom_20_regular.svg?raw";
import i_checkmark from "@fluentui/svg-icons/icons/checkmark_20_regular.svg?raw";
import i_chevron_down from "@fluentui/svg-icons/icons/chevron_down_20_regular.svg?raw";
import i_chevron_right from "@fluentui/svg-icons/icons/chevron_right_20_regular.svg?raw";
import i_chevron_up from "@fluentui/svg-icons/icons/chevron_up_20_regular.svg?raw";
import i_copy from "@fluentui/svg-icons/icons/copy_20_regular.svg?raw";
import i_data_pie from "@fluentui/svg-icons/icons/data_pie_20_regular.svg?raw";
import i_database from "@fluentui/svg-icons/icons/database_20_regular.svg?raw";
import i_delete from "@fluentui/svg-icons/icons/delete_20_regular.svg?raw";
import i_delete_dismiss from "@fluentui/svg-icons/icons/delete_dismiss_20_regular.svg?raw";
import i_developer_board from "@fluentui/svg-icons/icons/developer_board_20_regular.svg?raw";
import i_dismiss from "@fluentui/svg-icons/icons/dismiss_20_regular.svg?raw";
import i_document from "@fluentui/svg-icons/icons/document_20_regular.svg?raw";
import i_document_copy from "@fluentui/svg-icons/icons/document_copy_20_regular.svg?raw";
import i_flash from "@fluentui/svg-icons/icons/flash_20_regular.svg?raw";
import i_folder from "@fluentui/svg-icons/icons/folder_20_regular.svg?raw";
import i_folder_open from "@fluentui/svg-icons/icons/folder_open_20_regular.svg?raw";
import i_folder_prohibited from "@fluentui/svg-icons/icons/folder_prohibited_20_regular.svg?raw";
import i_hard_drive from "@fluentui/svg-icons/icons/hard_drive_20_regular.svg?raw";
import i_history from "@fluentui/svg-icons/icons/history_20_regular.svg?raw";
import i_important from "@fluentui/svg-icons/icons/important_20_regular.svg?raw";
import i_info from "@fluentui/svg-icons/icons/info_20_regular.svg?raw";
import i_key from "@fluentui/svg-icons/icons/key_20_regular.svg?raw";
import i_local_language from "@fluentui/svg-icons/icons/local_language_20_regular.svg?raw";
import i_lock_closed from "@fluentui/svg-icons/icons/lock_closed_20_regular.svg?raw";
import i_more_horizontal from "@fluentui/svg-icons/icons/more_horizontal_20_regular.svg?raw";
import i_open from "@fluentui/svg-icons/icons/open_20_regular.svg?raw";
import i_options from "@fluentui/svg-icons/icons/options_20_regular.svg?raw";
import i_record from "@fluentui/svg-icons/icons/record_20_regular.svg?raw";
import i_search from "@fluentui/svg-icons/icons/search_20_regular.svg?raw";
import i_server from "@fluentui/svg-icons/icons/server_20_regular.svg?raw";
import i_shield from "@fluentui/svg-icons/icons/shield_20_regular.svg?raw";
import i_sign_out from "@fluentui/svg-icons/icons/sign_out_20_regular.svg?raw";
import i_usb_stick from "@fluentui/svg-icons/icons/usb_stick_20_regular.svg?raw";
import i_warning from "@fluentui/svg-icons/icons/warning_20_regular.svg?raw";
import i_weather_moon from "@fluentui/svg-icons/icons/weather_moon_20_regular.svg?raw";
import i_weather_sunny from "@fluentui/svg-icons/icons/weather_sunny_20_regular.svg?raw";
import i_zoom_out from "@fluentui/svg-icons/icons/zoom_out_20_regular.svg?raw";

/**
 * Fluent System Icons (the set Windows 11 itself uses), addressed by the
 * Material Symbols names the rest of the app was written with.
 */
const ICONS: Record<string, string> = {
  album: i_record,
  app_registration: i_database,
  apps: i_apps,
  arrow_back: i_arrow_left,
  bolt: i_flash,
  check: i_checkmark,
  chevron_right: i_chevron_right,
  close: i_dismiss,
  content_copy: i_copy,
  dark_mode: i_weather_moon,
  data_object: i_braces,
  delete: i_delete,
  delete_forever: i_delete_dismiss,
  delete_sweep: i_broom,
  donut_large: i_data_pie,
  draft: i_document,
  expand_less: i_chevron_up,
  expand_more: i_chevron_down,
  folder: i_folder,
  folder_delete: i_folder_prohibited,
  folder_open: i_folder_open,
  hard_drive: i_hard_drive,
  history: i_history,
  info: i_info,
  key: i_key,
  lan: i_server,
  light_mode: i_weather_sunny,
  lock: i_lock_closed,
  logout: i_sign_out,
  memory: i_developer_board,
  more_vert: i_more_horizontal,
  open_in_new: i_open,
  priority_high: i_important,
  refresh: i_arrow_clockwise,
  search: i_search,
  search_off: i_search,
  shield: i_shield,
  stacks: i_document_copy,
  translate: i_local_language,
  tune: i_options,
  undo: i_arrow_undo,
  usb: i_usb_stick,
  warning: i_warning,
  zoom_out: i_zoom_out,
};

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`icon ${className}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.info }}
    />
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
