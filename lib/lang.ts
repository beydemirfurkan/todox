import { cookies } from "next/headers";

import { LANG_COOKIE, TZ_COOKIE } from "./cookies";
import { DEFAULT_LANG, type Lang, isLang, translator } from "./i18n";
import { DEFAULT_TZ, isValidTimeZone } from "./util/time";

export { LANG_COOKIE };

/** Server-side language resolution: the cookie, or the default. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const fromCookie = store.get(LANG_COOKIE)?.value;
  if (isLang(fromCookie)) return fromCookie;
  return DEFAULT_LANG;
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
