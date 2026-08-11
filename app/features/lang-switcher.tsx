import { type Lang, type T } from "@/lib/i18n";
import { LangMenu } from "./lang-menu";

/**
 * A popup in the same shape as the account menu beside it.
 *
 * It was a native `<select>` before this, which was a fair call — it scales
 * past two languages and costs nothing. What it could not do is look like the
 * other dropdown in the same row: the OS draws the open list, so one of the two
 * controls in the navbar opened into system chrome and the other into the app.
 * The choice itself is still a plain form post, and there is still a
 * `<noscript>` path.
 */
export function LangSwitcher({ lang, t }: { lang: Lang; t: T }) {
  return (
    <LangMenu lang={lang} label={t("languageLabel")} switchingLabel={t("langSwitching")} />
  );
}
