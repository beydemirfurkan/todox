import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The image pins pnpm so that fetching it is a cached layer rather than part of
 * every dependency install — see the comment in the Dockerfile for the deploy
 * that failure cost. The pin is a second copy of `packageManager`, and a second
 * copy is only safe while something holds it against the first.
 *
 * What drift would do is worse than a version being wrong: the lockfile is
 * resolved by the pnpm on a developer's machine and installed by the pnpm in
 * the image, and `--frozen-lockfile` compares the lockfile to `package.json`,
 * not to the resolver that wrote it. Two different pnpm versions can therefore
 * both accept the same lockfile and disagree about what it means, which is a
 * production image built from a dependency tree nobody tested.
 */
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

const dockerfile = read("Dockerfile");
const pkg = JSON.parse(read("package.json")) as { packageManager?: string };

describe("the image's package manager", () => {
  it("is prepared in the base stage rather than on first use", () => {
    // The point of the pin. If this moves back into the build stage — or
    // disappears — the fetch rejoins `pnpm install` and the failure this
    // guards against comes back, silently, until a network blip finds it.
    expect(dockerfile).toMatch(/corepack prepare pnpm@\S+ --activate/);
  });

  it("is the version package.json names", () => {
    const pinned = /corepack prepare (pnpm@\S+) --activate/.exec(dockerfile)?.[1];
    expect(pinned, "no `corepack prepare pnpm@… --activate` in the Dockerfile").toBeDefined();
    expect(pinned).toBe(pkg.packageManager);
  });
});
