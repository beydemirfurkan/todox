import { describe, expect, it } from "vitest";

import { preferredLang } from "./lang";

/**
 * `Accept-Language` is written by somebody else's browser, and this repository
 * has a rule about that: every entry is a claim about software we do not
 * control. The parsing is also the half that fails quietly — a wrong answer
 * here is not an error, it is a page in the wrong language, which the reader
 * experiences as a site that is not for them.
 *
 * The bug being fixed: there was no parsing at all. Turkish was both the
 * default and the fallback, so a browser asking for English got Turkish and
 * the only way out was a switcher the reader had to notice.
 */
describe("choosing a language from what the browser asked for", () => {
  it("answers the language when it is one we have", () => {
    expect(preferredLang("en")).toBe("en");
    expect(preferredLang("tr")).toBe("tr");
  });

  it("ignores the region, since we translate languages and not places", () => {
    for (const header of ["en-US", "en-GB", "EN-us"]) expect(preferredLang(header)).toBe("en");
    expect(preferredLang("tr-TR")).toBe("tr");
  });

  it("honours quality values rather than reading left to right", () => {
    // A real Chrome in Istanbul with English first sends exactly this shape.
    // Taking the first entry would answer English to somebody who said they
    // prefer Turkish.
    expect(preferredLang("en;q=0.7,tr;q=0.9")).toBe("tr");
    expect(preferredLang("tr;q=0.5,en;q=0.8")).toBe("en");
  });

  it("treats a missing q as the strongest preference", () => {
    // Per the spec q defaults to 1, so an unqualified tag outranks q=0.9.
    expect(preferredLang("en,tr;q=0.9")).toBe("en");
  });

  it("skips languages we do not have and keeps looking", () => {
    expect(preferredLang("de,fr;q=0.8,en;q=0.5")).toBe("en");
  });

  it("has no opinion when nothing matches", () => {
    // Undefined rather than the default, so the caller decides — and the
    // caller is the one place that knows what the default is.
    expect(preferredLang("de,fr;q=0.8")).toBeUndefined();
    expect(preferredLang("")).toBeUndefined();
    expect(preferredLang(null)).toBeUndefined();
    expect(preferredLang(undefined)).toBeUndefined();
  });

  it("treats * as no opinion, not as a match", () => {
    // `*` means "anything will do", which is a question for the default and
    // not a request for the first language in our list.
    expect(preferredLang("*")).toBeUndefined();
    // Behind a real preference it must not swallow it.
    expect(preferredLang("en;q=0.9,*;q=0.1")).toBe("en");
  });

  it("refuses a language the browser explicitly declined", () => {
    // q=0 is "not this one". Answering with it would be reading the header
    // backwards.
    expect(preferredLang("en;q=0")).toBeUndefined();
    expect(preferredLang("en;q=0,tr;q=0.5")).toBe("tr");
  });

  it("does not fall over on a malformed header", () => {
    // Anything can arrive here; a crash would be a 500 on the landing page.
    expect(preferredLang("en;q=notanumber")).toBeUndefined();
    expect(preferredLang(";;;")).toBeUndefined();
    expect(preferredLang(",,")).toBeUndefined();
    expect(preferredLang("en;;q=0.5;")).toBe("en");
  });

  it("tolerates the spacing browsers actually send", () => {
    expect(preferredLang("tr-TR, tr;q=0.9, en-US;q=0.8, en;q=0.7")).toBe("tr");
    expect(preferredLang("  en-GB ,  tr ; q=0.4 ")).toBe("en");
  });
});
