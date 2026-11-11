import { createContext, useContext } from "react";

export type Lang = "ru" | "en";

const ru = {
  search: "Поиск программ",
  all: "Все",
  programs: "Программы",
  store: "Microsoft Store",
  sortName: "По имени",
  sortSize: "По размеру",
  sortDate: "По дате установки",
  uninstall: "Удалить",
  forceRemove: "Принудительное удаление",
  forceFolder: "Удалить следы по папке…",
  refresh: "Обновить список",
  themeToggle: "Сменить тему",
  langToggle: "English",
  loading: "Загружаем список программ…",
  empty: "Ничего не найдено",
  count: "Программ: {n}",
  totalSize: "занято {size}",
  notElevated: "Запущено без прав администратора — часть следов удалить не получится.",
  restartAdmin: "Перезапустить от имени администратора",
  storeApp: "Приложение Store",

  confirmTitle: "Удалить «{name}»?",
  confirmText:
    "Сначала запустится штатный деинсталлятор, затем программа найдёт и уберёт оставшиеся файлы, папки и записи реестра.",
  confirmForceTitle: "Принудительно удалить «{name}»?",
  confirmForceText:
    "Деинсталлятор запускаться не будет. Программа найдёт все следы и уберёт их напрямую. Используйте, если обычное удаление не работает.",
  safetyNote: "Файлы попадут в корзину, для реестра создаётся резервная копия.",
  cancel: "Отмена",
  close: "Закрыть",
  done: "Готово",

  stepUninstall: "Работает деинсталлятор…",
  stepUninstallHint: "Если открылось окно удаления программы — завершите его.",
  stepWaiting: "Программа всё ещё установлена",
  stepWaitingHint:
    "Деинсталлятор ещё работает или был отменён. Поиск остатков начнётся автоматически, как только он закончит. Если он не сработал — удалите программу принудительно.",
  scanNow: "Искать остатки сейчас",
  stepScan: "Ищем остатки…",
  stepClean: "Удаляем найденное…",
  uninstallFailed: "Деинсталлятор завершился с ошибкой",

  reviewTitle: "Проверьте сомнительные находки",
  reviewText:
    "Эти элементы похожи на следы программы, но могут использоваться чем-то ещё. Отметьте, что удалить.",
  selectAll: "Выбрать все",
  deleteSelected: "Удалить выбранное ({n})",
  skip: "Пропустить",

  doneTitle: "«{name}» удалена",
  doneClean: "Следов не осталось.",
  doneRemoved: "Удалено следов: {n}",
  doneFreed: "освобождено {size}",
  doneFailed: "Не удалось удалить ({n}):",
  doneBackup: "Копия реестра сохранена — восстановить её можно кнопкой с часами в верхней панели.",
  errorTitle: "Что-то пошло не так",

  permanent: "Удалить безвозвратно — без корзины и без копии реестра",
  permanentNote: "Отменить такое удаление будет нельзя.",
  findTraces: "Найти следы",
  stuckTitle: "Программа не удалилась",
  stuckExit:
    "Штатный деинсталлятор завершился с ошибкой (код {code}), и программа осталась в системе.",
  stuckQuiet:
    "Штатный деинсталлятор закрылся, но программа осталась в системе. Возможно, удаление было отменено или деинсталлятор повреждён.",
  stuckMissing:
    "У этой программы нет рабочего деинсталлятора — его файл отсутствует на диске.",
  stuckHint:
    "Принудительное удаление найдёт файлы и записи программы и покажет их вам перед удалением.",
  stuckWatching:
    "Если окно деинсталлятора ещё открыто — завершите удаление, мы продолжим автоматически.",
  retry: "Запустить ещё раз",
  forceReviewTitle: "Проверьте, что будет удалено",
  forceReviewText:
    "Это найденные следы программы. Надёжные совпадения уже отмечены, сомнительные — нет.",
  unsure: "сомнительно",
  nothingDeleted: "Ничего не удалено",
  nothingFound: "Следов программы не найдено или вы ничего не выбрали.",
  doneShow: "Что было удалено ({n})",
  backups: "Резервные копии реестра",
  backupsText:
    "Копия создаётся при каждом удалении записей реестра. Восстановление вернёт записи на место.",
  backupsEmpty: "Копий пока нет.",
  backupEntries: "записей: {n}",
  backupDetails: "Показать записи",
  restore: "Восстановить",
  restored: "Восстановлено",
  restoreFailed: "Не удалось восстановить",
  deleteBackup: "Удалить копию",

  confirmText2:
    "Сначала запустится штатный деинсталлятор. Когда он закончит, программа найдёт оставшиеся файлы и записи реестра и покажет их вам — ничего не удаляется без подтверждения.",
  confirmForceText2:
    "Деинсталлятор запускаться не будет. Программа найдёт файлы и записи реестра и покажет их вам — ничего не удаляется без подтверждения.",
  goneWaiting: "Программа удалена — ждём, пока вы закроете окно деинсталлятора.",
  continueNow: "Продолжить сейчас",
  foundTitle: "Найдены остатки: {n}",
  foundForceTitle: "Найдены следы программы: {n}",
  foundText:
    "Отмечены надёжные совпадения. Сомнительные не отмечены — они могут использоваться другими программами.",
  sectionFiles: "Файлы и папки",
  sectionRegistry: "Реестр",
  sectionEmpty: "ничего не найдено",
  optTrash: "Файлы — в корзину",
  optBackup: "Сделать копию реестра",
  keepAll: "Ничего не удалять",
  doneKept: "Остатки оставлены без изменений.",
  doneDeleted: "Удалено",

  reason_installDir: "Папка установки",
  reason_uninstallEntry: "Запись в списке программ",
  reason_nameMatch: "Совпадает с названием",
  reason_publisherFolder: "В папке издателя",
  reason_similarName: "Похожее название",
  reason_shortcut: "Ярлык",
  reason_autostart: "Автозапуск",
  reason_appPath: "Путь приложения",
  reason_appData: "Данные приложения",
};

const en: typeof ru = {
  search: "Search programs",
  all: "All",
  programs: "Programs",
  store: "Microsoft Store",
  sortName: "By name",
  sortSize: "By size",
  sortDate: "By install date",
  uninstall: "Uninstall",
  forceRemove: "Force removal",
  forceFolder: "Remove traces by folder…",
  refresh: "Refresh list",
  themeToggle: "Toggle theme",
  langToggle: "Русский",
  loading: "Loading installed programs…",
  empty: "Nothing found",
  count: "{n} programs",
  totalSize: "{size} used",
  notElevated: "Running without administrator rights — some traces cannot be removed.",
  restartAdmin: "Restart as administrator",
  storeApp: "Store app",

  confirmTitle: "Uninstall “{name}”?",
  confirmText:
    "The program's own uninstaller runs first, then leftover files, folders and registry entries are found and removed.",
  confirmForceTitle: "Force remove “{name}”?",
  confirmForceText:
    "The uninstaller will not be started. All traces are found and removed directly. Use this when normal uninstall does not work.",
  safetyNote: "Files go to the Recycle Bin, the registry is backed up first.",
  cancel: "Cancel",
  close: "Close",
  done: "Done",

  stepUninstall: "Uninstaller is running…",
  stepUninstallHint: "If the program's uninstall window opened, complete it.",
  stepWaiting: "The program is still installed",
  stepWaitingHint:
    "The uninstaller is still running or was cancelled. The leftover scan starts automatically once it finishes. If it did not work, force the removal.",
  scanNow: "Scan for leftovers now",
  stepScan: "Scanning for leftovers…",
  stepClean: "Removing what was found…",
  uninstallFailed: "The uninstaller reported an error",

  reviewTitle: "Review uncertain findings",
  reviewText:
    "These items look like traces of the program but may be used by something else. Select what to delete.",
  selectAll: "Select all",
  deleteSelected: "Delete selected ({n})",
  skip: "Skip",

  doneTitle: "“{name}” removed",
  doneClean: "No traces left.",
  doneRemoved: "Traces removed: {n}",
  doneFreed: "{size} freed",
  doneFailed: "Could not delete ({n}):",
  doneBackup: "A registry backup was saved — restore it with the clock button in the top bar.",
  errorTitle: "Something went wrong",

  permanent: "Delete permanently — no Recycle Bin, no registry backup",
  permanentNote: "This kind of removal cannot be undone.",
  findTraces: "Find traces",
  stuckTitle: "The program was not removed",
  stuckExit:
    "The program's uninstaller failed (code {code}) and the program is still on the system.",
  stuckQuiet:
    "The program's uninstaller closed, but the program is still on the system. The removal may have been cancelled or the uninstaller is broken.",
  stuckMissing: "This program has no working uninstaller — its file is missing from the disk.",
  stuckHint:
    "Force removal finds the program's files and entries and shows them to you before deleting.",
  stuckWatching:
    "If the uninstaller window is still open, finish the removal and we will continue automatically.",
  retry: "Run again",
  forceReviewTitle: "Review what will be deleted",
  forceReviewText:
    "These are the traces found. Reliable matches are already selected, uncertain ones are not.",
  unsure: "uncertain",
  nothingDeleted: "Nothing was deleted",
  nothingFound: "No traces were found, or you selected nothing.",
  doneShow: "What was deleted ({n})",
  backups: "Registry backups",
  backupsText:
    "A backup is made whenever registry entries are deleted. Restoring puts the entries back.",
  backupsEmpty: "No backups yet.",
  backupEntries: "{n} entries",
  backupDetails: "Show entries",
  restore: "Restore",
  restored: "Restored",
  restoreFailed: "Could not restore",
  deleteBackup: "Delete backup",

  confirmText2:
    "The program's own uninstaller runs first. When it finishes, leftover files and registry entries are found and shown to you — nothing is deleted without confirmation.",
  confirmForceText2:
    "The uninstaller will not be started. Files and registry entries are found and shown to you — nothing is deleted without confirmation.",
  goneWaiting: "The program is removed — waiting for you to close the uninstaller window.",
  continueNow: "Continue now",
  foundTitle: "Leftovers found: {n}",
  foundForceTitle: "Program traces found: {n}",
  foundText:
    "Reliable matches are selected. Uncertain ones are not — other programs may be using them.",
  sectionFiles: "Files and folders",
  sectionRegistry: "Registry",
  sectionEmpty: "nothing found",
  optTrash: "Move files to the Recycle Bin",
  optBackup: "Back up the registry",
  keepAll: "Delete nothing",
  doneKept: "Leftovers were left untouched.",
  doneDeleted: "Deleted",

  reason_installDir: "Install folder",
  reason_uninstallEntry: "Entry in the programs list",
  reason_nameMatch: "Matches the name",
  reason_publisherFolder: "In the publisher's folder",
  reason_similarName: "Similar name",
  reason_shortcut: "Shortcut",
  reason_autostart: "Autostart",
  reason_appPath: "App path",
  reason_appData: "App data",
};

export type Key = keyof typeof ru;
const dict: Record<Lang, typeof ru> = { ru, en };

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function makeT(lang: Lang): T {
  return (key, params) => {
    let s: string = dict[lang][key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
    }
    return s;
  };
}

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "ru" || saved === "en") return saved;
  } catch {}
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export const I18n = createContext<{ lang: Lang; t: T }>({ lang: "en", t: makeT("en") });
export const useI18n = () => useContext(I18n);

export function formatSize(bytes: number | null | undefined, lang: Lang): string {
  if (!bytes) return "";
  const units = lang === "ru" ? ["Б", "КБ", "МБ", "ГБ"] : ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${v.toLocaleString(lang, { maximumFractionDigits: digits })} ${units[i]}`;
}

export function formatDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
}
