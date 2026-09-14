import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

/**
 * The doctor reads a machine it was not asked to change, so every test here
 * builds a home directory from nothing, writes the config a client would
 * have, and asks what the doctor makes of it. The reachability half is
 * mocked: what is under test is the reading, and the server has its own
 * suite.
 */

const state = vi.hoisted(() => ({
  home: "",
  reports: [] as { url: string; token: string }[],
  /** What the mocked server answers; a test flips it to fail. */
  ok: true,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, homedir: () => state.home }, homedir: () => state.home };
});

vi.mock("../scripts/install-mcp/reachability", () => ({
  runDoctor: async (opts: { url: string; token: string }) => {
    state.reports.push({ url: opts.url, token: opts.token });
    return state.ok ? { ok: true, detail: "briefing-ok" } : { ok: false, detail: "rejected the token" };
  },
}));

const { inspectInstalls, runInstallDoctor } = await import("./doctor");
const { claudeCodeContract, codexConfigFile, cursorContract, memoryFileFor, openCodeContract, vsCodeContract } =
  await import("../scripts/install-mcp/clients/contract");
const { memoryBlock } = await import("../scripts/install-mcp/memory");

const root = mkdtempSync(path.join(tmpdir(), "todox-doctor-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
beforeEach(async () => {
  state.home = path.join(root, `home-${n++}`);
  state.reports = [];
  state.ok = true;
  await fs.mkdir(state.home, { recursive: true });
});

const TOKEN = "todox_0123456789abcdefghij";
const URL = "https://www.todox.dev/api/mcp";

async function writeJson(file: string, doc: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(doc, null, 2));
}

const httpEntry = (type: string) => ({ type, url: URL, headers: { Authorization: `Bearer ${TOKEN}` } });

const about = (findings: { subject: string; level: string; detail: string }[], subject: string) =>
  findings.filter((f) => f.subject === subject);

describe("a machine with nothing on it", () => {
  it("says so per client, and has nothing to reach", async () => {
    const { findings, reachable } = await inspectInstalls(state.home);
    for (const client of ["claude-code", "codex", "cursor", "vscode", "opencode"]) {
      const [only] = about(findings, client);
      expect(only?.level, client).toBe("info");
      expect(only?.detail, client).toMatch(/no config at/);
    }
    expect(reachable).toEqual([]);
  });
});

describe("a good entry", () => {
  it("is reported ok with the token masked, and becomes something to reach", async () => {
    await writeJson(claudeCodeContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    const { findings, reachable } = await inspectInstalls(state.home);

    const [entry] = about(findings, "claude-code");
    expect(entry).toMatchObject({ level: "ok" });
    expect(entry!.detail).toContain("entry ok (http, https://www.todox.dev/api/mcp, todo…ghij)");
    expect(entry!.detail).not.toContain(TOKEN);
    expect(reachable).toEqual([{ url: URL, token: TOKEN }]);
  });

  it("is followed by the memory file's verdict, and only then", async () => {
    await writeJson(claudeCodeContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    expect(about((await inspectInstalls(state.home)).findings, "claude-code")[1]).toMatchObject({
      level: "warn",
      detail: expect.stringMatching(/CLAUDE\.md does not exist/),
    });

    const memory = memoryFileFor("claude-code");
    await fs.mkdir(path.dirname(memory), { recursive: true });
    await fs.writeFile(memory, `# mine\n\n${memoryBlock()}\n`);
    expect(about((await inspectInstalls(state.home)).findings, "claude-code")[1]).toMatchObject({
      level: "ok",
      detail: expect.stringMatching(/carries the todox block/),
    });

    // A client with no entry is not told about its memory file at all.
    expect(about((await inspectInstalls(state.home)).findings, "cursor")).toHaveLength(1);
  });

  it("is reached once per distinct url and token, however many clients share it", async () => {
    await writeJson(claudeCodeContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    await writeJson(cursorContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    const { reachable } = await inspectInstalls(state.home);
    expect(reachable).toHaveLength(1);
  });

  it("is a stdio entry when it has a command, with nothing to reach over HTTP", async () => {
    await writeJson(cursorContract().current.file, {
      mcpServers: { todox: { command: "npx", args: ["-y", "todox-mcp.tgz"] } },
    });
    const { findings, reachable } = await inspectInstalls(state.home);
    expect(about(findings, "cursor")[0]).toMatchObject({ level: "ok", detail: expect.stringMatching(/stdio entry \(npx\)/) });
    expect(reachable).toEqual([]);
  });
});

describe("the silent failures, named", () => {
  it("a type the client ignores", async () => {
    // VS Code wants "http"; "remote" is OpenCode's word and VS Code drops the
    // entry without a sound.
    await writeJson(vsCodeContract().current.file, { servers: { todox: httpEntry("remote") } });
    const [entry] = about((await inspectInstalls(state.home)).findings, "vscode");
    expect(entry).toMatchObject({ level: "fail" });
    expect(entry!.detail).toContain('type "remote"');
    expect(entry!.detail).toContain('wants "http"');
  });

  it("a missing type", async () => {
    await writeJson(cursorContract().current.file, {
      mcpServers: { todox: { url: URL, headers: { Authorization: `Bearer ${TOKEN}` } } },
    });
    const [entry] = about((await inspectInstalls(state.home)).findings, "cursor");
    expect(entry).toMatchObject({ level: "fail", detail: expect.stringMatching(/has no type/) });
  });

  it("a missing bearer header", async () => {
    await writeJson(cursorContract().current.file, { mcpServers: { todox: { type: "http", url: URL } } });
    const [entry] = about((await inspectInstalls(state.home)).findings, "cursor");
    expect(entry).toMatchObject({ level: "fail", detail: expect.stringMatching(/Authorization: Bearer/) });
  });

  it("an entry under the wrong root key", async () => {
    // Accepted into the file, never read: the single most common VS Code bug.
    await writeJson(vsCodeContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    const [entry] = about((await inspectInstalls(state.home)).findings, "vscode");
    expect(entry).toMatchObject({ level: "warn", detail: expect.stringMatching(/has no todox entry/) });
  });

  it("an install that only ever landed in a layout this client does not read", async () => {
    const contract = vsCodeContract();
    if (contract.stale.length === 0) return; // no stale layout on this platform
    await writeJson(contract.stale[0]!.file, { servers: { todox: httpEntry("http") } });
    const [entry] = about((await inspectInstalls(state.home)).findings, "vscode");
    expect(entry).toMatchObject({ level: "fail" });
    expect(entry!.detail).toContain("only where this client does not read it");
  });

  it("a config file that cannot be parsed", async () => {
    const file = cursorContract().current.file;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json");
    const [entry] = about((await inspectInstalls(state.home)).findings, "cursor");
    expect(entry).toMatchObject({ level: "fail", detail: expect.stringMatching(/cannot be parsed/) });
  });

  it("an entry that applies to one checkout only", async () => {
    const cwd = path.join(state.home, "repo");
    await writeJson(path.join(cwd, ".cursor", "mcp.json"), { mcpServers: { todox: httpEntry("http") } });
    await writeJson(path.join(cwd, ".mcp.json"), { mcpServers: { todox: httpEntry("http") } });
    const checkout = about((await inspectInstalls(cwd)).findings, "checkout");
    expect(checkout).toHaveLength(2);
    expect(checkout.map((f) => f.detail).join("\n")).toMatch(/\.cursor\/mcp\.json carries a todox entry that cursor/);
    expect(checkout.map((f) => f.detail).join("\n")).toMatch(/\.mcp\.json carries a todox entry that claude-code/);
    for (const f of checkout) expect(f.level).toBe("warn");
  });
});

describe("the two clients with a shape of their own", () => {
  it("codex: a section written the way the installer writes it", async () => {
    const file = codexConfigFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `[mcp_servers.todox]\nurl = "${URL}"\n\n[mcp_servers.todox.http_headers]\n"Authorization" = "Bearer ${TOKEN}"\n`,
    );
    const { findings, reachable } = await inspectInstalls(state.home);
    expect(about(findings, "codex")[0]).toMatchObject({ level: "ok" });
    expect(reachable).toEqual([{ url: URL, token: TOKEN }]);
  });

  it("codex: a section written the way the README shows it", async () => {
    const file = codexConfigFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `[mcp_servers.todox]\nurl = "${URL}"\nhttp_headers = { Authorization = "Bearer ${TOKEN}" }\n`,
    );
    const { reachable } = await inspectInstalls(state.home);
    expect(reachable).toEqual([{ url: URL, token: TOKEN }]);
  });

  it("codex: a config with no todox section", async () => {
    const file = codexConfigFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `[mcp_servers.other]\nurl = "x"\n`);
    expect(about((await inspectInstalls(state.home)).findings, "codex")[0]).toMatchObject({
      level: "warn",
      detail: expect.stringMatching(/has no \[mcp_servers\.todox\]/),
    });
  });

  it("opencode: an entry in either layout is found, and the layout is named", async () => {
    await writeJson(openCodeContract("v1").current.file, { mcp: { todox: httpEntry("remote") } });
    const v1 = about((await inspectInstalls(state.home)).findings, "opencode");
    expect(v1[0]).toMatchObject({ level: "ok" });
    expect(v1.at(-1)!.detail).toContain("mcp.todox, the v1 layout");

    await writeJson(openCodeContract("v2").current.file, { mcp: { servers: { todox: httpEntry("remote") } } });
    const v2 = about((await inspectInstalls(state.home)).findings, "opencode");
    expect(v2[0]).toMatchObject({ level: "ok" });
    expect(v2.at(-1)!.detail).toContain("mcp.servers.todox, the v2 layout");
  });
});

describe("the exit code", () => {
  const lines: string[] = [];
  const write = (line: string) => lines.push(line);
  beforeEach(() => lines.splice(0));

  it("is 1 when there is nothing to reach", async () => {
    expect(await runInstallDoctor(state.home, write)).toBe(1);
    expect(lines.at(-1)).toMatch(/no usable todox entry/);
    expect(state.reports).toEqual([]);
  });

  it("is 0 when an entry is usable and the server answers", async () => {
    await writeJson(claudeCodeContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    expect(await runInstallDoctor(state.home, write)).toBe(0);
    expect(state.reports).toEqual([{ url: URL, token: TOKEN }]);
    expect(lines.at(-1)).toMatch(/server\s+: ok/);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("is 1 when the server refuses the token", async () => {
    await writeJson(claudeCodeContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    state.ok = false;
    expect(await runInstallDoctor(state.home, write)).toBe(1);
    expect(lines.at(-1)).toMatch(/FAIL .*rejected the token/);
  });

  it("is 1 when one client is fine and another is broken", async () => {
    await writeJson(claudeCodeContract().current.file, { mcpServers: { todox: httpEntry("http") } });
    await writeJson(vsCodeContract().current.file, { servers: { todox: httpEntry("remote") } });
    expect(await runInstallDoctor(state.home, write)).toBe(1);
  });
});
