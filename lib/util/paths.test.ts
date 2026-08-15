import { describe, expect, it } from "vitest";

import {
  isAbsolutePath,
  isInside,
  lastSegment,
  normalisePath,
  repoKey,
  repoLabel,
  repoLink,
  sameOsFamily,
  scrubRemote,
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

describe("repoLink", () => {
  /** `git remote get-url origin` answers in whichever form the clone used. */
  it("turns an scp-style remote into something a browser can open", () => {
    expect(repoLink("git@github.com:beydemirfurkan/todox.git")).toBe(
      "https://github.com/beydemirfurkan/todox",
    );
    expect(repoLink("git@gitlab.com:group/sub/proj.git")).toBe(
      "https://gitlab.com/group/sub/proj",
    );
  });

  it("tidies the https form", () => {
    expect(repoLink("https://github.com/me/repo.git")).toBe("https://github.com/me/repo");
    expect(repoLink("https://github.com/me/repo/")).toBe("https://github.com/me/repo");
    expect(repoLink("http://github.com/me/repo")).toBe("https://github.com/me/repo");
  });

  it("drops credentials, because this string gets rendered", () => {
    expect(repoLink("https://user:tok@github.com/me/repo.git")).toBe(
      "https://github.com/me/repo",
    );
  });

  it("returns null rather than guessing", () => {
    expect(repoLink(null)).toBeNull();
    expect(repoLink("")).toBeNull();
    expect(repoLink("   ")).toBeNull();
    expect(repoLink("not a url")).toBeNull();
    expect(repoLink("ssh://git@host/repo")).toBeNull();
    expect(repoLink("file:///srv/repo.git")).toBeNull();
    expect(repoLink("https://github.com")).toBeNull();
  });
});

/**
 * The comparison that replaces "same absolute path" as a project's identity.
 *
 * Whether two clones are the same repository cannot depend on which URL form
 * the developer happened to use, or the machine they cloned it on.
 */
describe("repoKey", () => {
  it("gives the two common clone forms the same key", () => {
    expect(repoKey("git@github.com:me/repo.git")).toBe(
      repoKey("https://github.com/me/repo"),
    );
    expect(repoKey("https://github.com/me/repo.git")).toBe("github.com/me/repo");
  });

  it("ignores case, which git hosts do too", () => {
    expect(repoKey("https://GitHub.com/Me/Repo")).toBe(repoKey("git@github.com:me/repo.git"));
  });

  /** `repoLink` refuses to link to these; they are still identities. */
  it("handles the remotes that are not browser links", () => {
    expect(repoKey("ssh://git@github.com/me/repo.git")).toBe("github.com/me/repo");
    expect(repoKey("ssh://git@github.com:22/me/repo.git")).toBe("github.com/me/repo");
    expect(repoKey("git://github.com/me/repo")).toBe("github.com/me/repo");
  });

  it("never lets a credential become part of the key", () => {
    expect(repoKey("https://user:tok@github.com/me/repo.git")).toBe("github.com/me/repo");
  });

  it("returns null rather than inventing an identity", () => {
    expect(repoKey(null)).toBeNull();
    expect(repoKey("")).toBeNull();
    expect(repoKey("not a url")).toBeNull();
  });

  /** Two different repos must never collide, or a merge would be automatic. */
  it("keeps different repositories apart", () => {
    expect(repoKey("git@github.com:me/a.git")).not.toBe(repoKey("git@github.com:me/b.git"));
    expect(repoKey("git@github.com:me/repo.git")).not.toBe(
      repoKey("git@gitlab.com:me/repo.git"),
    );
  });
});

describe("sameOsFamily", () => {
  it("separates a Windows path from a POSIX one", () => {
    expect(sameOsFamily("C:/Users/me/todox", "/Users/me/todox")).toBe(false);
    expect(sameOsFamily("C:\\Users\\me\\todox", "/Users/me/todox")).toBe(false);
  });

  it("keeps two paths of the same kind together, whatever the drive", () => {
    expect(sameOsFamily("C:/a", "D:/b")).toBe(true);
    expect(sameOsFamily("/Users/a", "/home/b")).toBe(true);
  });
});

/**
 * The MCP server now runs `git remote get-url origin` by itself and sends the
 * answer, so a token in one developer's git config would travel without them
 * ever typing it.
 */
describe("scrubRemote", () => {
  it("removes an embedded credential", () => {
    expect(scrubRemote("https://user:ghp_secret@github.com/me/repo.git")).toBe(
      "https://github.com/me/repo.git",
    );
    expect(scrubRemote("https://ghp_secret@github.com/me/repo.git")).toBe(
      "https://github.com/me/repo.git",
    );
  });

  it("leaves a clean remote exactly as the developer would recognise it", () => {
    expect(scrubRemote("https://github.com/me/repo.git")).toBe(
      "https://github.com/me/repo.git",
    );
    expect(scrubRemote("git@github.com:me/repo.git")).toBe("git@github.com:me/repo.git");
  });
});

describe("repoLabel", () => {
  it("prints the part anybody recognises", () => {
    expect(repoLabel("https://github.com/me/repo")).toBe("github.com/me/repo");
    expect(repoLabel("https://www.gitea.example/me/repo")).toBe("gitea.example/me/repo");
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
