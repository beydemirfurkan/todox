import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkRefs, findProjectRoot, hashFile } from "./workspace";

const dir = mkdtempSync(join(tmpdir(), "todox-ws-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

describe("hashFile", () => {
  it("hashes a real file", () => {
    expect(hashFile(write("a.ts", "hello"))).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is null for a path that is not there", () => {
    expect(hashFile(join(dir, "nope.ts"))).toBeNull();
  });

  it("is null for a directory rather than throwing", () => {
    expect(hashFile(dir)).toBeNull();
  });

  it("refuses anything that is not a regular file", () => {
    // /dev/zero would otherwise be read until the process runs out of memory.
    expect(hashFile("/dev/zero")).toBeNull();
  });

  it("changes when the contents do", () => {
    const p = write("b.ts", "one");
    const before = hashFile(p);
    writeFileSync(p, "two");
    expect(hashFile(p)).not.toBe(before);
  });
});

describe("findProjectRoot", () => {
  it("walks up to the marker", () => {
    const root = mkdtempSync(join(dir, "repo-"));
    writeFileSync(join(root, "package.json"), "{}");
    expect(findProjectRoot(join(root, "src", "deep", "file.ts"))).toBe(root);
  });

  it("returns a containing directory when there is no marker", () => {
    const p = write("loose.ts", "x");
    // Bounded to the sandbox on purpose. Without it this asserted something
    // about the machine rather than the function: a `package.json` sitting in
    // the system temp directory made the walk find a real marker and the test
    // failed locally while passing in CI.
    expect(findProjectRoot(p, dir)).toBe(dir);
  });
});

describe("checkRefs", () => {
  it("classifies each file and reports what it saw", () => {
    const same = write("same.ts", "unchanged");
    const moved = write("moved.ts", "before");
    const gone = join(dir, "gone.ts");

    const sameHash = hashFile(same)!;
    const movedHash = hashFile(moved)!;
    writeFileSync(moved, "after");

    const { checked, seen } = checkRefs([
      { id: 1, path: same, hash: sameHash },
      { id: 2, path: moved, hash: movedHash },
      { id: 3, path: gone, hash: "c".repeat(64) },
      { id: 4, path: same, hash: null },
    ]);

    expect(checked.map((c) => c.status)).toEqual([
      "fresh",
      "changed",
      "missing",
      "unknown",
    ]);
    // The write-back carries what is on disk now, not the verdict.
    expect(seen.find((s) => s.id === 3)!.hash).toBeNull();
    expect(seen.find((s) => s.id === 2)!.hash).toBe(hashFile(moved));
  });
});
