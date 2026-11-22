import { describe, expect, it } from "vitest";

import { gitHookBundle, importedSpecifiers } from "./bundle-node";

/**
 * The git hook runs from `~/.todox`, with no `node_modules` anywhere near it.
 * A bundle that still imports a package works on the machine that built it
 * and on no other.
 */
describe("the git hook bundle", () => {
  const bundle = gitHookBundle();

  it("imports nothing but node's built-ins", () => {
    const specifiers = importedSpecifiers(bundle);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !s.startsWith("node:"))).toEqual([]);
    expect(bundle).not.toMatch(/\brequire\(/);
  });

  it("runs itself only under its installed name", () => {
    expect(bundle).toContain('endsWith("git-hook.mjs")');
  });

  it("carries no path from the machine that built it", () => {
    expect(bundle).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
  });
});
