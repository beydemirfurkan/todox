import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * A stray `~/package.json` made the home directory the root of every
 * marker-less directory under it, so scratch folders registered as one project
 * named after the user. The home directory is never a project root.
 */
const state = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, homedir: () => state.home }, homedir: () => state.home };
});

const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { findProjectRoot, projectRootOf } = await import("./workspace");

const sandbox = mkdtempSync(join(tmpdir(), "todox-home-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

state.home = join(sandbox, "me");
const scratch = join(state.home, "Documents", "Codex", "2026-10-16", "fix");
mkdirSync(scratch, { recursive: true });
writeFileSync(join(state.home, "package.json"), "{}\n");

describe("the home directory", () => {
  it("is not a project, even with a marker in it", () => {
    expect(projectRootOf(scratch)).toBeUndefined();
  });

  it("does not stop a real repository under it from being found", () => {
    const repo = join(state.home, "code", "api");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "package.json"), "{}\n");
    expect(projectRootOf(join(repo, "src"))).toBe(repo);
  });

  it("leaves findProjectRoot's fallback to the directory it started from", () => {
    expect(findProjectRoot(scratch)).toBe(scratch);
  });
});
