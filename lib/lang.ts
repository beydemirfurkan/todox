import { cookies } from "next/headers";

import { LANG_COOKIE } from "./cookies";
import { DEFAULT_LANG, type Lang, isLang, translator } from "./i18n";

export { LANG_COOKIE };

/** Server-side language resolution. Cookie first, then Accept-Language. */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const fromCookie = store.get(LANG_COOKIE)?.value;
  if (isLang(fromCookie)) return fromCookie;
  return DEFAULT_LANG;
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: translator(lang) };
}
