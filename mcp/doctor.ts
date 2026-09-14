/**
 * `todox-mcp doctor [cwd]` -- what this machine's MCP configs say about todox,
 * and whether any of it works.
 *
 * The install CLI checks the config it just wrote. This checks the ones that
 * are already there, for the question that arrives weeks later: "I set it up
 * and the tools do not show". Every way that happens is silent -- the wrong
 * root key, the wrong `type`, an entry in a file the client reads only inside
 * one checkout, a stale layout an older todox wrote -- so the answer has to
 * come from reading the files the way each client does, and the contract in
 * `scripts/install-mcp/clients/contract.ts` is the one place that knows how.
 *
 * Read-only. It changes nothing and prints what it found, one line per
 * client, then reaches the server with every token it saw. The token is
 * never printed whole.
 *
 * In `mcp/` rather than `scripts/` because the README promises local mode
 * needs no clone: `npx <tarball> doctor` has to work, so this rides in the
 * stdio package. Everything it imports is node built-ins and the install
 * CLI's own pure modules; `pack-mcp` proves that on every build.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { MCP_SHAPES, type McpClientId } from "../lib/mcp-clients";
import {
  claudeCodeContract,
  codexConfigFile,
  cursorContract,
  ENTRY_NAME,
  type JsonClientContract,
  memoryFileFor,
  openCodeContract,
  type ServerLayout,
  vsCodeContract,
} from "../scripts/install-mcp/clients/contract";
import { findStaleEntries, readServerEntry } from "../scripts/install-mcp/clients/json-http";
import { readTomlServerSection } from "../scripts/install-mcp/clients/toml";
import { hasMemoryBlock } from "../scripts/install-mcp/memory";
import { maskToken } from "../scripts/install-mcp/prompt";
import { runDoctor } from "../scripts/install-mcp/reachability";

/**
 * One line of the report. `fail` is something the client will not read or
 * the server will not accept; `warn` is something that works and will stop
 * working, or works less than it could; `info` is a fact.
 */
export type Finding = {
  readonly subject: McpClientId | "checkout" | "server";
  readonly level: "ok" | "warn" | "fail" | "info";
  readonly detail: string;
};

/** A server entry the doctor can go and try. */
export type Reachable = { readonly url: string; readonly token: string };

export type Inspection = {
  readonly findings: Finding[];
  /** Distinct url+token pairs from every usable entry, in the order found. */
  readonly reachable: Reachable[];
};

const CLIENTS: readonly McpClientId[] = ["claude-code", "codex", "cursor", "vscode", "opencode"];

const finding = (subject: Finding["subject"], level: Finding["level"], detail: string): Finding => ({
  subject,
  level,
  detail,
});

/**
 * `~/.claude.json` rather than the absolute form, for a line a person reads.
 * `os.homedir()` at call time, the way the contract resolves paths, so the
 * two agree on what home is -- including under a test that moves it.
 */
function tilde(file: string): string {
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length)}` : file;
}

/**
 * What one JSON entry amounts to. `command` means a stdio entry, which has no
 * `type` to get wrong and nothing to reach over HTTP from here.
 */
function judgeEntry(
  client: McpClientId,
  file: string,
  entry: Record<string, unknown>,
  httpType: string,
): { findings: Finding[]; reachable?: Reachable } {
  const where = tilde(file);
  if (typeof entry.command === "string")
    return { findings: [finding(client, "ok", `${where}: stdio entry (${entry.command})`)] };

  const type = entry.type;
  const url = typeof entry.url === "string" ? entry.url : undefined;
  const auth = (entry as { headers?: { Authorization?: unknown } }).headers?.Authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;

  if (type !== httpType)
    return {
      findings: [
        finding(
          client,
          "fail",
          `${where}: entry has ${type === undefined ? "no type" : `type ${JSON.stringify(type)}`}; ` +
            `this client wants "${httpType}" -- the entry is accepted into the file and ignored`,
        ),
      ],
    };
  if (!url) return { findings: [finding(client, "fail", `${where}: entry has no url`)] };
  if (!bearer)
    return {
      findings: [
        finding(client, "fail", `${where}: entry has no "Authorization: Bearer …" header`),
      ],
    };
  return {
    findings: [finding(client, "ok", `${where}: entry ok (${type}, ${url}, ${maskToken(bearer)})`)],
    reachable: { url, token: bearer },
  };
}

/** The habit beside the config: an agent that has the tools and no reason to reach for them. */
async function inspectMemory(client: McpClientId): Promise<Finding> {
  const file = memoryFileFor(client);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return finding(
      client,
      "warn",
      `${tilde(file)} does not exist -- connecting is not the same as being used; ` +
        "write the habit there (install:mcp --write-memory, or paste the four lines)",
    );
  }
  return hasMemoryBlock(text)
    ? finding(client, "ok", `${tilde(file)} carries the todox block`)
    : finding(
        client,
        "warn",
        `${tilde(file)} has no todox block -- the habit is what makes an agent reach for the tools`,
      );
}

async function inspectJsonClient(
  client: McpClientId,
  contract: JsonClientContract,
  layouts: readonly ServerLayout[] = [contract.current],
): Promise<{ findings: Finding[]; reachable?: Reachable }> {
  const findings: Finding[] = [];
  let fileExists = false;
  for (const layout of layouts) {
    const read = await readServerEntry(layout, ENTRY_NAME);
    if (read.kind === "unreadable") {
      findings.push(finding(client, "fail", `${tilde(layout.file)} cannot be parsed: ${read.error}`));
      return { findings };
    }
    if (read.kind === "present") {
      const judged = judgeEntry(client, layout.file, read.entry, contract.httpType);
      findings.push(...judged.findings);
      if (judged.reachable) findings.push(await inspectMemory(client));
      return { findings, reachable: judged.reachable };
    }
    fileExists ||= read.kind === "absent";
  }

  // Before "no config": an install that only ever landed in a layout this
  // client does not read is the case the file's absence would otherwise hide,
  // and it is the one that has been dead the whole time.
  const stale = await findStaleEntries(contract.stale, ENTRY_NAME);
  if (stale.length) {
    for (const s of stale)
      findings.push(
        finding(client, "fail", `todox entry only where this client does not read it: ${s}`),
      );
    return { findings };
  }
  findings.push(
    fileExists
      ? finding(client, "warn", `${tilde(contract.current.file)} has no todox entry`)
      : finding(client, "info", `no config at ${tilde(contract.current.file)}`),
  );
  return { findings };
}

/**
 * OpenCode keeps both layouts in one file and reads only the one its version
 * knows. Neither is "stale" from here -- the doctor cannot tell which OpenCode
 * is installed -- so an entry is reported with the layout it sits in, and the
 * reader checks it against the version they run.
 */
async function inspectOpenCode(): Promise<{ findings: Finding[]; reachable?: Reachable }> {
  const v2 = openCodeContract("v2");
  const v1 = openCodeContract("v1");
  const result = await inspectJsonClient("opencode", v2, [v2.current, v1.current]);
  const ok = result.findings.find((f) => f.level === "ok" && f.detail.includes("entry ok"));
  if (ok) {
    const inV1 = (await readServerEntry(v1.current, ENTRY_NAME)).kind === "present";
    const layout = inV1 ? "mcp.todox, the v1 layout" : "mcp.servers.todox, the v2 layout";
    result.findings.push(
      finding("opencode", "info", `found under ${layout}; the other major version ignores it`),
    );
  }
  return result;
}

async function inspectCodex(): Promise<{ findings: Finding[]; reachable?: Reachable }> {
  const file = codexConfigFile();
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { findings: [finding("codex", "info", `no config at ${tilde(file)}`)] };
  }
  const section = readTomlServerSection(text, ENTRY_NAME);
  if (!section)
    return { findings: [finding("codex", "warn", `${tilde(file)} has no [mcp_servers.${ENTRY_NAME}]`)] };
  const token = section.authorization?.startsWith("Bearer ")
    ? section.authorization.slice(7)
    : undefined;
  if (!section.url)
    return { findings: [finding("codex", "fail", `${tilde(file)}: [mcp_servers.${ENTRY_NAME}] has no url`)] };
  if (!token)
    return {
      findings: [
        finding("codex", "fail", `${tilde(file)}: [mcp_servers.${ENTRY_NAME}] has no Authorization: Bearer header`),
      ],
    };
  return {
    findings: [
      finding("codex", "ok", `${tilde(file)}: entry ok (${section.url}, ${maskToken(token)})`),
      await inspectMemory("codex"),
    ],
    reachable: { url: section.url, token },
  };
}

/**
 * The files inside a checkout that clients read instead of, or as well as,
 * the user-level one. A todox entry there is not wrong; it is in the one
 * place a cross-project memory must not be the only copy of, because in the
 * next repository the tools are simply absent and nothing says so.
 */
function checkoutLayouts(cwd: string): { client: string; layout: ServerLayout }[] {
  return [
    { client: "claude-code", layout: { file: path.join(cwd, ".mcp.json"), rootKeys: MCP_SHAPES["claude-code"].rootKeys } },
    { client: "cursor", layout: { file: path.join(cwd, ".cursor", "mcp.json"), rootKeys: MCP_SHAPES.cursor.rootKeys } },
    { client: "vscode", layout: { file: path.join(cwd, ".vscode", "mcp.json"), rootKeys: MCP_SHAPES.vscode.rootKeys } },
    { client: "opencode", layout: { file: path.join(cwd, "opencode.json"), rootKeys: MCP_SHAPES["opencode-v2"].rootKeys } },
    { client: "opencode", layout: { file: path.join(cwd, "opencode.json"), rootKeys: MCP_SHAPES["opencode-v1"].rootKeys } },
  ];
}

async function inspectCheckout(cwd: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const { client, layout } of checkoutLayouts(cwd)) {
    const read = await readServerEntry(layout, ENTRY_NAME).catch(() => ({ kind: "absent" as const }));
    if (read.kind === "present")
      findings.push(
        finding(
          "checkout",
          "warn",
          `${path.relative(cwd, layout.file) || layout.file} carries a todox entry that ${client} ` +
            "reads in this checkout only; the user-level config is what crosses projects",
        ),
      );
  }
  return findings;
}

/** Everything the doctor can learn without a network. */
export async function inspectInstalls(cwd: string): Promise<Inspection> {
  const findings: Finding[] = [];
  const reachable: Reachable[] = [];
  const seen = new Set<string>();
  const take = (r: { findings: Finding[]; reachable?: Reachable }) => {
    findings.push(...r.findings);
    if (r.reachable && !seen.has(`${r.reachable.url} ${r.reachable.token}`)) {
      seen.add(`${r.reachable.url} ${r.reachable.token}`);
      reachable.push(r.reachable);
    }
  };

  for (const client of CLIENTS) {
    if (client === "claude-code") take(await inspectJsonClient(client, claudeCodeContract()));
    else if (client === "cursor") take(await inspectJsonClient(client, cursorContract()));
    else if (client === "vscode") take(await inspectJsonClient(client, vsCodeContract()));
    else if (client === "opencode") take(await inspectOpenCode());
    else take(await inspectCodex());
  }
  findings.push(...(await inspectCheckout(cwd)));
  return { findings, reachable };
}

const LABEL: Record<Finding["subject"], string> = {
  "claude-code": "claude-code",
  codex: "codex      ",
  cursor: "cursor     ",
  vscode: "vscode     ",
  opencode: "opencode   ",
  checkout: "checkout   ",
  server: "server     ",
};

const MARK: Record<Finding["level"], string> = { ok: "ok  ", warn: "WARN", fail: "FAIL", info: "--  " };

/**
 * The command. Prints one line per finding, tries every server it found, and
 * answers with an exit code: 0 when at least one entry is usable, nothing is
 * broken and every server answered; 1 otherwise. Output goes to stderr like
 * the installer's, so a script can still pipe stdout.
 */
export async function runInstallDoctor(
  cwd: string,
  write: (line: string) => void = (line) => console.error(line),
): Promise<number> {
  const { findings, reachable } = await inspectInstalls(cwd);
  for (const f of findings) write(`[todox] ${LABEL[f.subject]} : ${MARK[f.level]} ${f.detail}`);

  let failed = findings.some((f) => f.level === "fail");
  if (reachable.length === 0) {
    write("[todox] server      : FAIL no usable todox entry on this machine -- nothing to reach");
    return 1;
  }
  for (const { url, token } of reachable) {
    const report = await runDoctor({ url, token, cwd });
    write(
      `[todox] server      : ${report.ok ? "ok  " : "FAIL"} ${url} with ${maskToken(token)} -- ${report.detail}`,
    );
    failed ||= !report.ok;
  }
  return failed ? 1 : 0;
}
