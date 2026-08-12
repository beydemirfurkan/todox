import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
