import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { client } from "./codex";

const TMP = path.join(os.tmpdir(), "todox-codex-test");
const CONFIG = path.join(TMP, ".codex", "config.toml");
let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeEach(async () => {
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  process.env.HOME = TMP;
  // Windows: os.homedir() reads USERPROFILE before HOME, so the redirect
  // would otherwise leak to the developer's real ~/.codex/config.toml.
  process.env.USERPROFILE = TMP;
  await fs.mkdir(path.dirname(CONFIG), { recursive: true });
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  await fs.rm(TMP, { recursive: true, force: true });
});

describe("codex installer", () => {
  it("creates ~/.codex/config.toml from scratch", async () => {
    const r = await client.install({
      transport: "http",
      url: "https://www.todox.dev/api/mcp",
      token: "tk",
    });
    expect(r.status).toBe("created");
    expect((await client.verify()).ok).toBe(true);
  });

  it("preserves other sections when updating", async () => {
    await fs.writeFile(
      CONFIG,
      '[other]\nkey = "value"\n\n[mcp_servers.unrelated]\nurl = "https://x/mcp"\n',
      "utf8",
    );
    await client.install({ transport: "http", url: "https://y/mcp", token: "tk2" });
    const text = await fs.readFile(CONFIG, "utf8");
    expect(text).toContain('[other]\nkey = "value"');
    expect(text).toContain("[mcp_servers.unrelated]");
    expect(text).toContain("[mcp_servers.todox]");
    expect(text).toContain("https://y/mcp");
  });

  it("survives a Windows sharing-violation on the rename", async () => {
    // The installer used to call fs.rename directly with a deterministic
    // pid.tmp suffix; on Windows an antivirus scan mid-install returned
    // EPERM and the whole install failed. The shared writeTextFile helper
    // retries the rename, so a one-shot EPERM is now invisible to callers.
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
      const result = await client.install({
        transport: "http",
        url: "https://www.todox.dev/api/mcp",
        token: "tk",
      });
      expect(result.status).toBe("created");
      expect(calls).toBeGreaterThanOrEqual(2);
      const text = await fs.readFile(CONFIG, "utf8");
      expect(text).toContain("[mcp_servers.todox]");
    } finally {
      renameSpy.mockRestore();
    }
  });
});
