import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BEGIN, blockFor, hookLine, install, status, uninstall, withBlock, withoutBlock } from "./install";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "todox-install-"));
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

function setup() {
  const dir = repo();
  const home = mkdtempSync(join(tmpdir(), "todox-home-"));
  const bundle = join(mkdtempSync(join(tmpdir(), "todox-bundle-")), "git-hook.mjs");
  writeFileSync(bundle, "// bundle");
  return { dir, home, bundle, env: { TODOX_HOME: home } };
}

const hook = (dir: string, event: string) => join(dir, ".git", "hooks", event);
const blocks = (text: string) => text.split(BEGIN).length - 1;

describe("hook install", () => {
  it("writes both hooks, executable, and copies the script beside a private config", () => {
    const s = setup();
    const report = install({ cwd: s.dir, env: s.env, bundle: s.bundle, token: "todox_t", url: "http://x" });

    expect(report.ok).toBe(true);
    for (const event of ["post-commit", "post-rewrite"]) {
      expect(readFileSync(hook(s.dir, event), "utf8")).toBe(`#!/bin/sh\n${blockFor(s.home, event)}\n`);
      // Windows has no executable bit; git there runs a hook by its name.
      if (process.platform !== "win32") expect(statSync(hook(s.dir, event)).mode & 0o111).not.toBe(0);
    }
    expect(existsSync(join(s.home, "git-hook.mjs"))).toBe(true);
    expect(JSON.parse(readFileSync(join(s.home, "config.json"), "utf8"))).toEqual({ token: "todox_t", url: "http://x" });
    if (process.platform !== "win32") expect(statSync(join(s.home, "config.json")).mode & 0o077).toBe(0);
  });

  it("is idempotent: a second install leaves one block", () => {
    const s = setup();
    install({ cwd: s.dir, env: s.env, bundle: s.bundle });
    install({ cwd: s.dir, env: s.env, bundle: s.bundle });
    expect(blocks(readFileSync(hook(s.dir, "post-commit"), "utf8"))).toBe(1);
  });

  it("keeps an existing hook and runs before its trailing exit", () => {
    const s = setup();
    writeFileSync(hook(s.dir, "post-commit"), "#!/bin/sh\necho mine\nexit 0\n");
    install({ cwd: s.dir, env: s.env, bundle: s.bundle });
    const text = readFileSync(hook(s.dir, "post-commit"), "utf8");
    expect(text.startsWith("#!/bin/sh\necho mine\n")).toBe(true);
    expect(text.indexOf(BEGIN)).toBeLessThan(text.indexOf("exit 0"));
  });

  it("does not edit a hook in another language, and says what to add", () => {
    const s = setup();
    writeFileSync(hook(s.dir, "post-commit"), "#!/usr/bin/env python3\nprint(1)\n");
    const report = install({ cwd: s.dir, env: s.env, bundle: s.bundle });
    expect(report.ok).toBe(false);
    expect(readFileSync(hook(s.dir, "post-commit"), "utf8")).toBe("#!/usr/bin/env python3\nprint(1)\n");
    expect(report.lines.join("\n")).toContain(hookLine(s.home, "post-commit"));
  });

  it("does not write into a working tree's shared hooks (husky, lefthook)", () => {
    const s = setup();
    execFileSync("git", ["-C", s.dir, "config", "core.hooksPath", ".husky"]);
    const report = install({ cwd: s.dir, env: s.env, bundle: s.bundle });
    expect(report.ok).toBe(false);
    expect(report.lines[0]).toMatch(/core\.hooksPath/);
    expect(existsSync(hook(s.dir, "post-commit"))).toBe(false);
  });

  it("refuses outside a repository, and without a bundle", () => {
    const s = setup();
    expect(install({ cwd: mkdtempSync(join(tmpdir(), "plain-")), env: s.env, bundle: s.bundle }).ok).toBe(false);
    expect(install({ cwd: s.dir, env: s.env, bundle: "/nope/git-hook.mjs" }).ok).toBe(false);
  });

  it("names TODOX_HOME in the line, since git runs it under any environment", () => {
    expect(hookLine("/h", "post-commit")).toContain('TODOX_HOME="/h" node "/h/git-hook.mjs" post-commit');
    expect(hookLine("C:\\Users\\a\\.todox", "post-commit")).toContain('"C:/Users/a/.todox/git-hook.mjs"');
  });
});

describe("hook uninstall and status", () => {
  it("takes out only its own block, and removes a file it created", () => {
    const s = setup();
    writeFileSync(hook(s.dir, "post-commit"), "#!/bin/sh\necho mine\nexit 0\n");
    install({ cwd: s.dir, env: s.env, bundle: s.bundle });
    expect(status(s.dir, s.env).lines.slice(0, 2)).toEqual(["post-commit: installed", "post-rewrite: installed"]);

    uninstall(s.dir, s.env);

    expect(readFileSync(hook(s.dir, "post-commit"), "utf8")).toBe("#!/bin/sh\necho mine\nexit 0\n");
    expect(existsSync(hook(s.dir, "post-rewrite"))).toBe(false);
    expect(status(s.dir, s.env).lines[0]).toBe("post-commit: not installed");
  });

  it("never prints the token", () => {
    const s = setup();
    install({ cwd: s.dir, env: s.env, bundle: s.bundle, token: "todox_secret" });
    expect(status(s.dir, s.env).lines.join("\n")).not.toContain("todox_secret");
  });
});

describe("withBlock / withoutBlock", () => {
  it("round-trips a hook without a trailing exit", () => {
    const original = "#!/bin/bash\necho a\n";
    expect(withoutBlock(withBlock(original, blockFor("/h", "post-commit")) as string)).toBe(original);
  });
});
