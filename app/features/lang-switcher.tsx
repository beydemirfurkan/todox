import { LANGS, LANG_NAME, type Lang, type T } from "@/lib/i18n";
import { setLangAction } from "../actions";
import { LangButton } from "./lang-button";

/**
 * Two submit buttons in one form: works without JavaScript, and the current
 * language is announced rather than only shown as a filled pill.
 *
 * The buttons are not disabled on the active language. Disabling took them out
 * of the tab order, so a keyboard user could not reach the thing that says
 * which language they are in — and on a phone a dead button is indis-
 * tinguishable from a missed tap, which is how "the language does not change"
 * started. Submitting the language already in use is a no-op that costs a
 * cookie write.
 */
export function LangSwitcher({ lang, t }: { lang: Lang; t: T }) {
  return (
    <form action={setLangAction} className="flex items-center">
      <fieldset className="flex items-center gap-1.5 border-0 p-0">
        <legend className="sr-only">{t("languageLabel")}</legend>
        {LANGS.map((l) => (
          <LangButton
            key={l}
            lang={l}
            active={l === lang}
            name={LANG_NAME[l]}
            switchingLabel={t("langSwitching")}
          />
        ))}
      </fieldset>
    </form>
  );
}
