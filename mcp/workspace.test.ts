import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  checkRefs,
  findProjectRoot,
  gitBranch,
  gitCommitsSince,
  gitDirtyCount,
  gitHead,
  gitRemote,
  hashFile,
} from "./workspace";

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

/**
 * What a session did to the tree.
 *
 * These are the only thing the observations feature reads, and every one of
 * them runs on a developer's machine against a directory an agent named. So
 * the properties that matter are the unglamorous ones: never throw, never
 * shell out, and answer "I do not know" rather than something plausible --
 * a wrong commit count in a briefing is worse than an absent one, because the
 * next session has no way to tell it is wrong.
 */
describe("reading the session's git state", () => {
  const hasGit = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

  /** A real repository, because a guard that returns early proves nothing. */
  const repoWith = (commits: string[]) => {
    const repo = mkdtempSync(join(tmpdir(), "todox-obs-"));
    spawnSync("git", ["-C", repo, "init", "-q", "-b", "main"], { stdio: "ignore" });
    for (const subject of commits)
      spawnSync(
        "git",
        [
          "-C", repo,
          "-c", "user.email=t@example.com",
          "-c", "user.name=t",
          "commit", "-q", "--allow-empty", "-m", subject,
        ],
        { stdio: "ignore" },
      );
    return repo;
  };

  describe("a directory that is not a checkout", () => {
    it("answers nothing rather than guessing", () => {
      expect(gitBranch(dir)).toBeUndefined();
      expect(gitHead(dir)).toBeUndefined();
      expect(gitDirtyCount(dir)).toBeUndefined();
      expect(gitCommitsSince(dir, "abc")).toBeUndefined();
    });
  });

  it.runIf(hasGit)("reads the branch and the head", () => {
    const repo = repoWith(["first"]);
    expect(gitBranch(repo)).toBe("main");
    expect(gitHead(repo)).toMatch(/^[a-f0-9]{40}$/);
    rmSync(repo, { recursive: true, force: true });
  });

  /**
   * A repository with no commits at all. `rev-parse HEAD` fails here, and it
   * is the state every `git init` starts in -- so it is the first thing an
   * agent in a fresh directory would hit.
   */
  it.runIf(hasGit)("survives a repository with no commits", () => {
    const repo = repoWith([]);
    expect(gitHead(repo)).toBeUndefined();
    expect(gitDirtyCount(repo)).toBe(0);
    rmSync(repo, { recursive: true, force: true });
  });

  it.runIf(hasGit)("counts the commits made since a baseline, newest first", () => {
    const repo = repoWith(["first"]);
    const base = gitHead(repo)!;
    for (const subject of ["second", "third"])
      spawnSync(
        "git",
        [
          "-C", repo,
          "-c", "user.email=t@example.com",
          "-c", "user.name=t",
          "commit", "-q", "--allow-empty", "-m", subject,
        ],
        { stdio: "ignore" },
      );

    const since = gitCommitsSince(repo, base)!;
    expect(since.count).toBe(2);
    expect(since.subjects[0]).toBe("third");
    expect(since.subjects).toContain("second");
    expect(since.subjects).not.toContain("first");
    rmSync(repo, { recursive: true, force: true });
  });

  it.runIf(hasGit)("counts nothing when the baseline is the head", () => {
    const repo = repoWith(["only"]);
    expect(gitCommitsSince(repo, gitHead(repo)!)!.count).toBe(0);
    rmSync(repo, { recursive: true, force: true });
  });

  /**
   * A baseline that no longer exists -- the sha was rebased away, or the row
   * came from a different machine's checkout. Answering 0 would be a lie the
   * briefing would repeat.
   */
  it.runIf(hasGit)("answers nothing for a baseline it cannot find", () => {
    const repo = repoWith(["only"]);
    expect(gitCommitsSince(repo, "f".repeat(40))).toBeUndefined();
    rmSync(repo, { recursive: true, force: true });
  });

  it.runIf(hasGit)("counts the files with uncommitted changes", () => {
    const repo = repoWith(["only"]);
    expect(gitDirtyCount(repo)).toBe(0);
    writeFileSync(join(repo, "one.ts"), "x");
    writeFileSync(join(repo, "two.ts"), "y");
    expect(gitDirtyCount(repo)).toBe(2);
    rmSync(repo, { recursive: true, force: true });
  });

  /**
   * Detached HEAD is a normal state -- a bisect, a checkout of a tag -- and
   * `rev-parse --abbrev-ref` answers the literal string "HEAD" for it. Passing
   * that through would put a branch called HEAD in front of a reader.
   */
  it.runIf(hasGit)("reports no branch when HEAD is detached", () => {
    const repo = repoWith(["first", "second"]);
    const head = gitHead(repo)!;
    spawnSync("git", ["-C", repo, "checkout", "-q", head], { stdio: "ignore" });
    expect(gitBranch(repo)).toBeUndefined();
    expect(gitHead(repo)).toBe(head);
    rmSync(repo, { recursive: true, force: true });
  });

  /**
   * The same argv guarantee `gitRemote` is tested for, on the three helpers
   * that also take a caller-supplied directory.
   */
  it.runIf(hasGit)("treats a semicolon in the path as a directory name", () => {
    const outer = mkdtempSync(join(tmpdir(), "todox-obs-x-"));
    const sentinel = join(process.cwd(), "todox-observe-sentinel");
    const nasty = join(outer, "evil; touch todox-observe-sentinel");
    mkdirSync(nasty);
    spawnSync("git", ["-C", nasty, "init", "-q", "-b", "main"], { stdio: "ignore" });

    expect(gitBranch(nasty)).toBe("main");
    expect(gitDirtyCount(nasty)).toBe(0);
    expect(hashFile(sentinel)).toBeNull();
    rmSync(outer, { recursive: true, force: true });
  });

  /**
   * Subjects are user text from a repository this process does not own. The
   * cap is what stops one commit message being the whole payload.
   */
  it.runIf(hasGit)("caps how much commit text it carries", () => {
    const repo = repoWith(["x"]);
    const base = gitHead(repo)!;
    for (let i = 0; i < 30; i++)
      spawnSync(
        "git",
        [
          "-C", repo,
          "-c", "user.email=t@example.com",
          "-c", "user.name=t",
          "commit", "-q", "--allow-empty", "-m", `subject ${i} ${"y".repeat(500)}`,
        ],
        { stdio: "ignore" },
      );

    const since = gitCommitsSince(repo, base)!;
    // The count is honest even though the text is not all carried.
    expect(since.count).toBe(30);
    expect(since.subjects.length).toBeLessThanOrEqual(3);
    for (const s of since.subjects) expect(s.length).toBeLessThanOrEqual(200);
    rmSync(repo, { recursive: true, force: true });
    // Thirty sequential `git commit` processes, and on a Windows runner a
    // process spawn is the expensive part rather than anything this test is
    // about: measured at 5,624ms against vitest's 5,000ms default, which is a
    // coin flip rather than a signal. It passed on seven other branches and on
    // main in the same hour.
    //
    // The timeout is raised rather than the commit count lowered, because the
    // count is the property: the cap is three subjects and thirty is what
    // proves the count stays honest while the text does not. Trimming it to
    // make a clock happy would be weakening the assertion to fix the
    // environment.
    //
    // A test that fails at random on one platform is worse than a slow one --
    // it teaches everybody to re-run red CI instead of reading it.
  }, 30_000);

  /**
   * The baseline is the one value in this file that git did not produce.
   *
   * It arrives in the reply to `recordObservation` -- whatever string an
   * earlier client stored in `head_sha` -- and `base..HEAD` is built as a
   * single argument, so a value beginning with a dash reaches git as an option
   * rather than a revision. Today `rev-list` rejects the unknown option before
   * `log` is ever reached, which is an accident of call order rather than a
   * property: `git log --output=<file>` does write that file. The guard makes
   * it a property, and this test is what keeps it one if the calls are ever
   * reordered or the count is dropped.
   */
  it.runIf(hasGit)("never hands git a baseline it would read as an option", () => {
    const repo = repoWith(["only"]);
    const sentinel = join(repo, "written-by-a-flag");

    expect(gitCommitsSince(repo, `--output=${sentinel}`)).toBeUndefined();
    // `..HEAD` is appended to whatever is passed, so that is the name git
    // would have written.
    expect(existsSync(`${sentinel}..HEAD`)).toBe(false);

    // A ref name is not an object id. git would resolve `main..HEAD` happily,
    // which is what makes this the assertion that fails if the guard goes.
    expect(gitCommitsSince(repo, "main")).toBeUndefined();

    // A filter, not a wall: a real baseline still answers.
    expect(gitCommitsSince(repo, gitHead(repo)!)!.count).toBe(0);
    rmSync(repo, { recursive: true, force: true });
  });
});
