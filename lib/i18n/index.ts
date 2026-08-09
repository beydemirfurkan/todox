import { en, type Key } from "./en";
import { tr } from "./tr";
import { splitDuration } from "../util/time";

export type { Key };

export const LANGS = ["tr", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Turkish is the default: this is a Turkish developer's tool first. */
export const DEFAULT_LANG: Lang = "tr";

export const LANG_NAME: Record<Lang, string> = { en: "English", tr: "Türkçe" };

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}

const DICT: Record<Lang, Record<Key, string>> = { en, tr };

export type T = (key: Key, vars?: Record<string, string | number>) => string;

export function translator(lang: Lang): T {
  const table = DICT[lang] ?? DICT[DEFAULT_LANG];
  return (key, vars) => {
    let s: string = table[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  };
}

/** Locale-aware relative time, so timestamps read right in both languages. */
export function ago(iso: string, t: T) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t("justNow");
  if (s < 3600) return t("minutesAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("hoursAgo", { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t("daysAgo", { n: Math.floor(s / 86400) });
  return new Date(iso).toISOString().slice(0, 10);
}

/** "2h 15m" / "2sa 15dk" — at most two units, because nobody reads three. */
export function duration(msTotal: number | null, t: T) {
  if (msTotal === null) return t("durNone");
  const { days, hours, minutes, totalMinutes } = splitDuration(msTotal);
  if (totalMinutes < 1) return t("durMinutes", { n: 0 });
  const parts: string[] = [];
  if (days) parts.push(t("durDays", { n: days }));
  if (hours) parts.push(t("durHours", { n: hours }));
  if (!days && minutes) parts.push(t("durMinutes", { n: minutes }));
  return parts.slice(0, 2).join(" ");
}
