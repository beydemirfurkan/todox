import { describe, expect, it } from "vitest";

import { en } from "./en";
import { tr } from "./tr";
import { ago, DEFAULT_LANG, duration, isLang, translator, type Key, type Lang } from "./index";

/** The dictionary the fallback should land in, whichever language that is. */
const DICT_FOR_DEFAULT = DEFAULT_LANG === "tr" ? tr : en;

describe("isLang", () => {
  it("accepts the languages that exist", () => {
    expect(isLang("tr")).toBe(true);
    expect(isLang("en")).toBe(true);
  });

  // This is the only thing standing between a form field and the cookie.
  it("rejects everything else", () => {
    for (const v of ["de", "TR", "", undefined, null, 1, {}, ["tr"]]) {
      expect(isLang(v)).toBe(false);
    }
  });
});

describe("translator", () => {
  it("returns the language asked for", () => {
    expect(translator("en")("signOut")).toBe(en.signOut);
    expect(translator("tr")("signOut")).toBe(tr.signOut);
  });

  it("falls back to the default language for one that does not exist", () => {
    // Asserted against `DEFAULT_LANG` rather than against Turkish by name: the
    // property is "an unknown language lands on the default", and writing the
    // current default in by hand is what made this fail the day it changed
    // rather than the day it broke.
    const t = translator("de" as Lang);
    expect(t("signOut")).toBe(DICT_FOR_DEFAULT.signOut);
  });

  it("gives back the key itself when nothing has it", () => {
    expect(translator("tr")("nope" as Key)).toBe("nope");
  });

  it("substitutes every occurrence of a placeholder", () => {
    expect(translator("en")("minutesAgo", { n: 5 })).toBe("5m ago");
  });
});

describe("the two dictionaries", () => {
  const keys = Object.keys(en) as Key[];

  // The type system guarantees tr has every key. It says nothing about what is
  // inside them, and a translation that drops `{n}` silently loses the number.
  it("keep their placeholders", () => {
    const placeholders = (s: string) => (s.match(/\{[a-z_]+\}/gi) ?? []).sort();
    for (const k of keys) {
      expect({ key: k, vars: placeholders(tr[k]) }).toEqual({
        key: k,
        vars: placeholders(en[k]),
      });
    }
  });

  it("have no blank strings", () => {
    for (const k of keys) {
      expect(en[k].trim(), `en.${k}`).not.toBe("");
      expect(tr[k].trim(), `tr.${k}`).not.toBe("");
    }
  });
});

describe("ago", () => {
  const t = translator("en");
  const isoAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

  it("reads as just now under a minute", () => {
    expect(ago(isoAgo(59), t)).toBe(en.justNow);
  });

  it("counts minutes, then hours, then days", () => {
    expect(ago(isoAgo(61), t)).toBe("1m ago");
    expect(ago(isoAgo(2 * 3600), t)).toBe("2h ago");
    expect(ago(isoAgo(3 * 86400), t)).toBe("3d ago");
  });

  it("gives up and shows the date past a month", () => {
    const iso = isoAgo(31 * 86400);
    expect(ago(iso, t)).toBe(iso.slice(0, 10));
  });
});

describe("duration", () => {
  const t = translator("en");
  const minutes = (n: number) => n * 60_000;

  it("says so when there is nothing to report", () => {
    expect(duration(null, t)).toBe(en.durNone);
  });

  it("rounds anything under a minute down to zero rather than hiding it", () => {
    expect(duration(20_000, t)).toBe("0m");
  });

  it("stops at two units", () => {
    expect(duration(minutes(90), t)).toBe("1h 30m");
    // Days and hours are the two that survive; the minutes are dropped.
    expect(duration(minutes(2 * 24 * 60 + 3 * 60 + 15), t)).toBe("2d 3h");
  });
});
