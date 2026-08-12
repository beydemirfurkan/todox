import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { readJsonFile, writeJsonFile } from "./atomic-write";

const root = mkdtempSync(path.join(tmpdir(), "todox-aw-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A directory per test, so nothing here depends on the order they run in. */
const caseDir = async (name: string) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

describe("readJsonFile / writeJsonFile", () => {
  it("returns null for missing file", async () => {
    const dir = await caseDir("missing");
    expect(await readJsonFile(path.join(dir, "absent.json"))).toBeNull();
  });

  it("round-trips an object", async () => {
    const dir = await caseDir("round-trip");
    const file = path.join(dir, "cfg.json");
    await writeJsonFile(file, { a: 1, b: ["x"] });
    expect(await readJsonFile(file)).toEqual({ a: 1, b: ["x"] });
  });

  it("creates the directory on the way", async () => {
    const dir = await caseDir("nested");
    const file = path.join(dir, "deep", "down", "cfg.json");
    await writeJsonFile(file, { ok: true });
    expect(await readJsonFile(file)).toEqual({ ok: true });
  });

  it("survives concurrent single-writes (no torn file)", async () => {
    const dir = await caseDir("race");
    const file = path.join(dir, "race.json");
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => writeJsonFile(file, { who: i })),
    );
    const out = await readJsonFile<{ who: number }>(file);
    expect(typeof out?.who).toBe("number");
  });

  it("leaves no temporary files behind", async () => {
    const dir = await caseDir("no-litter");
    const file = path.join(dir, "cfg.json");
    await Promise.all(
      Array.from({ length: 4 }, (_, i) => writeJsonFile(file, { who: i })),
    );
    // Every write names its own temporary file; a collision used to make one
    // rename fail outright, which is what this notices if it comes back.
    expect(await fs.readdir(dir)).toEqual(["cfg.json"]);
  });

  it("treats unparseable JSON as a hard error, not as absent", async () => {
    const dir = await caseDir("corrupt");
    const file = path.join(dir, "cfg.json");
    await fs.writeFile(file, "{ not json", "utf8");
    // Only ENOENT means "not configured". Swallowing a parse error here would
    // silently overwrite a config the user had hand-edited.
    await expect(readJsonFile(file)).rejects.toThrow();
  });

  it("retries the rename when Windows hands back a sharing violation", async () => {
    // EPERM/EACCES/EBUSY are what an antivirus scanner or a mid-replace writer
    // hands the rename on Windows; the file is there the next millisecond, so
    // a single retry is enough to clear the window. The old codex installer
    // used raw fs.rename and tripped this; the shared helper now retries up to
    // 5 times with exponential back-off before giving up.
    const dir = await caseDir("eperm-retry");
    const file = path.join(dir, "cfg.json");
    const originalRename = fs.rename;
    const renameSpy = vi.spyOn(fs, "rename");
    let calls = 0;
    renameSpy.mockImplementation(async (from, to) => {
      calls++;
      if (calls === 1) {
        const err: NodeJS.ErrnoException = new Error("busy");
        err.code = "EPERM";
        throw err;
      }
      return originalRename(from, to);
    });
    try {
      await writeJsonFile(file, { ok: true });
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(await readJsonFile(file)).toEqual({ ok: true });
    } finally {
      renameSpy.mockRestore();
    }
  });
});
