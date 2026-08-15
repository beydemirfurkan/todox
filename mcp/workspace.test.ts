import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkRefs, findProjectRoot, gitRemote, hashFile } from "./workspace";

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

/**
 * A project can hold paths from two machines now, so `checkRefs` meets paths it
 * was never going to be able to read.
 */
describe("checkRefs across machines", () => {
  const foreign = process.platform === "win32" ? "/Users/me/repo/a.ts" : "C:/Users/me/repo/a.ts";

  it("calls the other platform's path unknown, not missing", () => {
    const { checked } = checkRefs([{ id: 1, path: foreign, hash: "a".repeat(64) }]);
    expect(checked[0].status).toBe("unknown");
  });

  /**
   * The important half: reporting a null hash back would overwrite what the
   * machine that *can* read the file last saw, and the note would go stale on
   * a computer that never had it.
   */
  it("does not report a hash for a file it could never read", () => {
    const { seen } = checkRefs([{ id: 1, path: foreign, hash: "a".repeat(64) }]);
    expect(seen).toEqual([]);
  });
});

describe("gitRemote", () => {
  const hasGit = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

  it("is undefined for a directory that is not a checkout", () => {
    expect(gitRemote(dir)).toBeUndefined();
  });

  it.runIf(hasGit)("reads the origin of a real repository", () => {
    const repo = mkdtempSync(join(tmpdir(), "todox-git-"));
    spawnSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
    spawnSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:me/repo.git"], {
      stdio: "ignore",
    });

    expect(gitRemote(repo)).toBe("git@github.com:me/repo.git");
    rmSync(repo, { recursive: true, force: true });
  });

  /**
   * The developer whose split this feature exists for has a space in their home
   * directory ("C:/Users/Furkan Beydemir/todox"). A shell string gets that
   * wrong without anybody being malicious.
   */
  it.runIf(hasGit)("handles a path with a space in it", () => {
    const repo = mkdtempSync(join(tmpdir(), "todox git "));
    spawnSync("git", ["-C", repo, "init", "-q"], { stdio: "ignore" });
    spawnSync("git", ["-C", repo, "remote", "add", "origin", "https://example.com/a.git"], {
      stdio: "ignore",
    });

    expect(gitRemote(repo)).toBe("https://example.com/a.git");
    rmSync(repo, { recursive: true, force: true });
  });

  /**
   * The root comes from an agent's arguments. An argv element is one argument
   * whatever is inside it, so a semicolon is part of a directory name and not a
   * second command -- this test is what says so out loud.
   *
   * The repository is real, so the check reaches `git` rather than stopping at
   * the "is there a .git here" guard. A test that returns before spawning would
   * pass whether the call was safe or not.
   */
  it.runIf(hasGit)("treats a semicolon in the path as a directory name", () => {
    const repo = mkdtempSync(join(tmpdir(), "todox-x-"));
    // A bare filename, so the whole payload is still a legal directory name.
    // Were it run as a command, `touch` would drop it in the process's cwd.
    const sentinel = join(process.cwd(), "todox-pwned-sentinel");
    const nasty = join(repo, "evil; touch todox-pwned-sentinel");
    mkdirSync(nasty);
    spawnSync("git", ["-C", nasty, "init", "-q"], { stdio: "ignore" });
    spawnSync("git", ["-C", nasty, "remote", "add", "origin", "https://example.com/x.git"], {
      stdio: "ignore",
    });

    expect(gitRemote(nasty)).toBe("https://example.com/x.git");
    expect(hashFile(sentinel)).toBeNull();
    rmSync(repo, { recursive: true, force: true });
  });
});
