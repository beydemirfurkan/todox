import { describe, expect, it } from "vitest";

import {
  isAbsolutePath,
  isInside,
  lastSegment,
  normalisePath,
  shareToken,
  slugify,
  slugifyOr,
} from "./paths";

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

  /**
   * The server is Linux; the agent sending these paths often is not. A Windows
   * path was treated as relative, so `cwd` never resolved to a project and
   * never created one — the whole "just pass your working directory" promise
   * was dead on that platform.
   */
  it("understands Windows paths", () => {
    expect(isInside("C:\\Users\\me\\todox\\lib", "C:\\Users\\me\\todox")).toBe(true);
    expect(isInside("C:\\Users\\me\\todox", "C:\\Users\\me\\todox")).toBe(true);
    expect(isInside("C:\\Users\\me\\todox-old", "C:\\Users\\me\\todox")).toBe(false);
  });

  it("compares Windows paths case-insensitively, as that filesystem does", () => {
    expect(isInside("c:\\users\\me\\todox\\lib", "C:\\Users\\me\\todox")).toBe(true);
    // POSIX is case-sensitive and must stay that way.
    expect(isInside("/src/TODOX/lib", "/src/todox")).toBe(false);
  });

  it("does not care which separator was used", () => {
    expect(isInside("C:/Users/me/todox/lib", "C:\\Users\\me\\todox")).toBe(true);
  });
});

describe("isAbsolutePath", () => {
  it("accepts both platforms", () => {
    expect(isAbsolutePath("/src/todox")).toBe(true);
    expect(isAbsolutePath("C:\\Users\\me\\todox")).toBe(true);
    expect(isAbsolutePath("D:/work/todox")).toBe(true);
  });

  it("rejects a slug or a bare name", () => {
    expect(isAbsolutePath("todox")).toBe(false);
    expect(isAbsolutePath("./todox")).toBe(false);
    expect(isAbsolutePath("C:todox")).toBe(false);
  });
});

describe("lastSegment", () => {
  /** node:path.basename runs POSIX here, so it hands back the whole string. */
  it("names a project from either kind of path", () => {
    expect(lastSegment("/src/todox")).toBe("todox");
    expect(lastSegment("C:\\Users\\me\\todox")).toBe("todox");
    expect(lastSegment("C:\\Users\\me\\todox\\")).toBe("todox");
  });
});

describe("shareToken", () => {
  it("is as long as the other secrets", () => {
    // 32 bytes base64url. It used to be 12, the weakest secret in the app.
    expect(shareToken()).toHaveLength(43);
    expect(shareToken()).not.toBe(shareToken());
  });
});

describe("normalisePath", () => {
  /**
   * Both branches of `resolveOrCreate` have to agree. Only one of them folded
   * separators, so a project registered from `cwd` alone was stored with
   * backslashes while its neighbour was stored with forward slashes.
   */
  it("folds separators whichever way the caller wrote them", () => {
    expect(normalisePath("C:\\Users\\me\\repo")).toBe("C:/Users/me/repo");
    expect(normalisePath("C:/Users/me/repo")).toBe("C:/Users/me/repo");
    expect(normalisePath("/src/todox")).toBe("/src/todox");
  });

  it("drops a trailing separator, either kind", () => {
    expect(normalisePath("C:\\Users\\me\\repo\\")).toBe("C:/Users/me/repo");
    expect(normalisePath("/src/todox/")).toBe("/src/todox");
  });
});
