import { describe, expect, it } from "vitest";

import { isInside, shareToken, slugify, slugifyOr } from "./paths";

/**
 * Stripping everything outside [a-z0-9] mangled the language this app defaults
 * to. Every case here produced something wrong — or unroutable — before.
 */
describe("slugify", () => {
  it("folds Turkish letters instead of deleting them", () => {
    expect(slugify("Öğrenci Takip")).toBe("ogrenci-takip");
    expect(slugify("Çiğdem")).toBe("cigdem");
    expect(slugify("İstanbul Şubesi")).toBe("istanbul-subesi");
    expect(slugify("Ağ")).toBe("ag");
  });

  it("handles dotless ı, which carries no mark to strip", () => {
    expect(slugify("ışık")).toBe("isik");
    expect(slugify("Yazılım")).toBe("yazilim");
  });

  it("folds other accented latin too", () => {
    expect(slugify("café")).toBe("cafe");
    expect(slugify("Straße")).toBe("strasse");
    expect(slugify("smørrebrød")).toBe("smorrebrod");
  });

  it("leaves plain ascii alone", () => {
    expect(slugify("Checkout Service")).toBe("checkout-service");
    expect(slugify("todox")).toBe("todox");
  });

  it("collapses and trims separators", () => {
    expect(slugify("  --a  //  b -- ")).toBe("a-b");
  });

  it("never ends on a dash after truncation", () => {
    const s = slugify("x".repeat(47) + " tail");
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
  });

  it("returns empty when there is nothing to keep", () => {
    // A name with no latin at all. The caller decides what to do about it.
    expect(slugify("日本語")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});

describe("slugifyOr", () => {
  it("substitutes a routable fallback", () => {
    // An empty slug was accepted and produced /p/ — not a route, so the
    // project could not be opened at all.
    expect(slugifyOr("日本語")).toBe("project");
    expect(slugifyOr("Öç")).toBe("oc");
  });
});

describe("isInside", () => {
  it("respects segment boundaries", () => {
    expect(isInside("/src/todox/lib", "/src/todox")).toBe(true);
    expect(isInside("/src/todox", "/src/todox")).toBe(true);
    expect(isInside("/src/todox-old", "/src/todox")).toBe(false);
  });

  it("tolerates a trailing slash on the root", () => {
    expect(isInside("/src/todox/lib", "/src/todox/")).toBe(true);
  });
});

describe("shareToken", () => {
  it("is as long as the other secrets", () => {
    // 32 bytes base64url. It used to be 12, the weakest secret in the app.
    expect(shareToken()).toHaveLength(43);
    expect(shareToken()).not.toBe(shareToken());
  });
});
