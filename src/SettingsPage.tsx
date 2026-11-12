import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useI18n, type Lang } from "./i18n";
import { Icon } from "./ui";
import logo from "../app-icon.png";

export type ThemePref = "light" | "dark" | "system";

interface Props {
  themePref: ThemePref;
  setThemePref: (t: ThemePref) => void;
  setLang: (l: Lang) => void;
  elevated: boolean;
  onRestartAdmin: () => void;
}

/** Windows Settings–style page: theme, language, rights, about. */
export default function SettingsPage({
  themePref,
  setThemePref,
  setLang,
  elevated,
  onRestartAdmin,
}: Props) {
  const { t, lang } = useI18n();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("settings")}</h1>
      </header>

      <div className="page-scroll">
        <div className="settings">
          <h3 className="tweak-cat">{t("appearance")}</h3>
          <div className="card-row">
            <Icon name="palette" className="card-icon" />
            <div className="tweak-main">
              <div className="row-name">{t("theme")}</div>
              <div className="row-sub">{t("themeDesc")}</div>
            </div>
            <select
              className="combo"
              value={themePref}
              onChange={(e) => setThemePref(e.target.value as ThemePref)}
              aria-label={t("theme")}
            >
              <option value="light">{t("themeLight")}</option>
              <option value="dark">{t("themeDark")}</option>
              <option value="system">{t("themeSystem")}</option>
            </select>
          </div>
          <div className="card-row">
            <Icon name="translate" className="card-icon" />
            <div className="tweak-main">
              <div className="row-name">{t("language")}</div>
              <div className="row-sub">{t("languageDesc")}</div>
            </div>
            <select
              className="combo"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              aria-label={t("language")}
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>

          <h3 className="tweak-cat">{t("admin")}</h3>
          <div className="card-row">
            <Icon name="shield" className="card-icon" />
            <div className="tweak-main">
              <div className="row-name">{t("admin")}</div>
              <div className="row-sub wrap">{elevated ? t("adminOn") : t("adminOff")}</div>
            </div>
            {elevated ? (
              <span className="badge ok">
                <Icon name="check" />
              </span>
            ) : (
              <button className="btn" onClick={onRestartAdmin}>
                {t("restartAdmin")}
              </button>
            )}
          </div>

          <h3 className="tweak-cat">{t("about")}</h3>
          <div className="card-row">
            <img className="card-logo" src={logo} alt="" draggable={false} />
            <div className="tweak-main">
              <div className="row-name">Sweepr</div>
              <div className="row-sub">
                {t("aboutDesc")}
                {version && ` · ${t("version", { v: version })}`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
