import { LANGS, LANG_NAME, type Lang, type T } from "@/lib/i18n";
import { setLangAction } from "../actions";

/**
 * Two submit buttons in one form: works without JavaScript, and the current
 * language is announced rather than only shown as a filled pill.
 */
export function LangSwitcher({ lang, t }: { lang: Lang; t: T }) {
  return (
    <form action={setLangAction} className="flex items-center">
      <fieldset className="flex items-center gap-1 border-0 p-0">
        <legend className="sr-only">{t("languageLabel")}</legend>
        {LANGS.map((l) => {
          const active = l === lang;
          return (
            <button
              key={l}
              name="lang"
              value={l}
              type="submit"
              aria-current={active ? "true" : undefined}
              disabled={active}
              className="display rounded-full border-[1.5px] border-line px-2 pt-[2px] pb-[3px] text-[12px] leading-none font-bold disabled:cursor-default"
              style={
                active
                  ? { background: "var(--accent)", color: "var(--on-fill)" }
                  : { background: "var(--inset)", color: "var(--muted)" }
              }
            >
              <span className="sr-only">{LANG_NAME[l]}</span>
              <span aria-hidden="true">{l.toUpperCase()}</span>
            </button>
          );
        })}
      </fieldset>
    </form>
  );
}
