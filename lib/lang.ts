import { cookies, headers } from "next/headers";

import { LANG_COOKIE, TZ_COOKIE } from "./cookies";
import { DEFAULT_LANG, LANGS, type Lang, isLang, translator } from "./i18n";
import { DEFAULT_TZ, isValidTimeZone } from "./util/time";

export { LANG_COOKIE };

/**
 * Server-side language resolution: the cookie, then the browser, then the
 * default.
 *
 * The cookie comes first because it is the only one of the three that is a
 * choice — somebody used the switcher, and nothing a browser sends should
 * overrule that.
 *
 * The header came second only after this shipped without it. Turkish is the
 * default and the fallback was the default, so every visitor whose browser
 * asked for English got Turkish anyway: the README is English, the landing page
 * was not, and the switcher only helps a reader who guesses that the page has
 * another language to switch to.
 *
 * No cost in rendering strategy: `cookies()` above already opts these routes
 * out of static generation, so reading a header alongside it changes nothing.
 */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const fromCookie = store.get(LANG_COOKIE)?.value;
  if (isLang(fromCookie)) return fromCookie;

  const accepted = (await headers()).get("accept-language");
  return preferredLang(accepted) ?? DEFAULT_LANG;
}

/**
 * The best match from an `Accept-Language` header, or undefined for no opinion.
 *
 * Exported for its test rather than for callers: the header is written by
 * somebody else's browser and the parsing is the part that goes wrong quietly.
 * Quality values are honoured because they are how a browser says "English, but
 * Turkish is fine" — reading left to right instead would answer English to a
 * reader who prefers Turkish.
 *
 * Only the primary subtag is compared, so `en-GB` and `en-US` both mean `en`.
 */
export function preferredLang(header: string | null | undefined): Lang | undefined {
  if (!header) return undefined;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number(q);
      return { tag: (tag ?? "").trim().toLowerCase(), quality };
    })
    // A `q=0` is an explicit refusal, and NaN means the header is malformed;
    // neither is a preference worth acting on.
    .filter((entry) => entry.tag !== "" && Number.isFinite(entry.quality) && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    if (tag === "*") return undefined; // "anything", which the default answers
    const primary = tag.split("-")[0];
    const hit = LANGS.find((lang) => lang === primary);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The reader's timezone, for report windows.
 *
 * Server rendering happens in UTC, so without this "today" starts at 03:00 for
 * anyone in Istanbul. `TzProbe` writes the cookie on first load; until it does,
 * the default stands.
 */
export async function getTz(): Promise<string> {
  const fromCookie = (await cookies()).get(TZ_COOKIE)?.value;
  return fromCookie && isValidTimeZone(fromCookie) ? fromCookie : DEFAULT_TZ;
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: translator(lang) };
}
