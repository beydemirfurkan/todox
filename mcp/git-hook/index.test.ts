import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gitHookConfig } from "./config";
import { runGitHook } from "./index";

const home = () => mkdtempSync(join(tmpdir(), "todox-home-"));

afterEach(() => vi.unstubAllGlobals());

describe("the git hook entry point", () => {
  it("does nothing without a token, and says why in its log", async () => {
    const h = home();
    expect(await runGitHook("post-commit", tmpdir(), { TODOX_HOME: h })).toBe("no-token");
    expect(readFileSync(join(h, "git-hook", "hook.log"), "utf8")).toMatch(/no token/);
  });

  it("obeys the switches the other carriers obey", async () => {
    expect(await runGitHook("post-commit", tmpdir(), { TODOX_HOME: home(), TODOX_OBSERVE: "off" })).toBe("disabled");
    expect(await runGitHook("post-commit", tmpdir(), { TODOX_HOME: home(), TODOX_HOOKS: "off" })).toBe("disabled");
  });

  it("refuses an event it was not installed for", async () => {
    expect(await runGitHook("pre-push", tmpdir(), { TODOX_HOME: home() })).toBe("unknown-event");
  });

  it("makes no request outside a checkout", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outside = mkdtempSync(join(tmpdir(), "todox-not-a-repo-"));
    expect(await runGitHook("post-commit", outside, { TODOX_HOME: home(), TODOX_TOKEN: "t" })).toBe("not-a-checkout");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("git hook config", () => {
  it("prefers the environment, then the file install wrote, then the hosted server", () => {
    const h = home();
    writeFileSync(join(h, "config.json"), JSON.stringify({ token: "todox_saved", url: "https://self.example" }));
    expect(gitHookConfig({ TODOX_HOME: h }, vi.fn())).toMatchObject({ token: "todox_saved", url: "https://self.example" });
    expect(gitHookConfig({ TODOX_HOME: h, TODOX_TOKEN: "todox_env" }, vi.fn()).token).toBe("todox_env");
    expect(gitHookConfig({ TODOX_HOME: home() }, vi.fn()).url).toBe("https://www.todox.dev");
  });

  it("warns about a config file it cannot read", () => {
    const h = home();
    writeFileSync(join(h, "config.json"), "{ nope");
    const warn = vi.fn();
    expect(gitHookConfig({ TODOX_HOME: h }, warn).token).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unreadable/));
  });
});
