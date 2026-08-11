import { type Lang, type T } from "@/lib/i18n";
import { setLangAction } from "../actions";
import { LangSelect } from "./lang-select";

/**
 * A native <select> in place of the two-pill toggle.
 *
 * The form stays a plain `<form action>` so it works without JavaScript; the
 * inner select auto-submits on change when JS is on, and a small submit button
 * is rendered for the no-JS case. Submitting the language already in use is a
 * no-op that costs a cookie write — disabling the active option would take it
 * out of the tab order, which is how "the language does not change" started.
 */
export function LangSwitcher({ lang, t }: { lang: Lang; t: T }) {
  return (
    <form action={setLangAction} className="flex items-center gap-2">
      <label htmlFor="lang-select" className="sr-only">
        {t("languageLabel")}
      </label>
      <LangSelect
        id="lang-select"
        name="lang"
        current={lang}
        switchingLabel={t("langSwitching")}
      />
      <noscript>
        <button type="submit" className="pill">
          {t("apply")}
        </button>
      </noscript>
    </form>
  );
}
