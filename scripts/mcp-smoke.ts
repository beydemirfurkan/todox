/**
 * End-to-end check of the agent path, run twice: once against the hosted
 * endpoint at /api/mcp, which is how almost everyone connects, and once
 * against the local stdio process, which is the mode that can hash files.
 *
 * Running the same assertions through both transports is what keeps
 * `mcp/tools.ts` honest as the single definition of the agent surface — a tool
 * that only works one way in fails here.
 *
 * Also proves the two things accounts have to guarantee: no token, no access;
 * wrong account, no access.
 *
 * Needs the web server running. Point TODOX_URL at it if it is not on :3000.
 */
import "./env";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as projectsRepo from "../lib/repositories/projects";
import * as tasksRepo from "../lib/repositories/tasks";
import * as usersRepo from "../lib/repositories/users";
import { createApiToken } from "../lib/services/auth";
import { hashPassword } from "../lib/util/password";
import { normalisePath } from "../lib/util/paths";

/** A throwaway repo the agent has never heard of, to prove auto-registration. */
const SCRATCH = join(tmpdir(), "todox-smoke-repo");
const URL_BASE = process.env.TODOX_URL ?? "http://localhost:3000";
const MODEL = "claude-opus-5";

/** What a remote agent is expected to compute for itself. */
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

async function ensureUser(username: string, name: string) {
  return (
    (await usersRepo.byUsername(username)) ??
    usersRepo.create({
      username,
      email: `${username}@todox.local`,
      name,
      password_hash: await hashPassword("smoke-password"),
    })
  );
}

type Mode = { label: string; local: boolean; transport(token: string): Transport };

const MODES: Mode[] = [
  {
    label: "remote (/api/mcp)",
    local: false,
    transport: (token) =>
      new StreamableHTTPClientTransport(new URL("/api/mcp", URL_BASE), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
  },
  {
    label: "local (stdio)",
    local: true,
    transport: (token) =>
      new StdioClientTransport({
        command: "pnpm",
        args: ["exec", "tsx", join(__dirname, "..", "mcp", "server.ts")],
        env: { ...process.env, TODOX_TOKEN: token, TODOX_URL: URL_BASE } as Record<
          string,
          string
        >,
      }),
  },
];

/** The same run through whichever way in it was handed. */
async function runSuite(mode: Mode, token: string) {
  console.log(`\n=========== ${mode.label} ===========`);

  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(mode.transport(token));

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));

  // Remote has no disk, so the agent is the only one who can supply these and
  // the schema must say so. Locally the process fills them in and hiding them
  // is what stops a model inventing a path it cannot see.
  const ctx = tools.tools.find((t) => t.name === "get_context");
  const props = Object.keys(
    (ctx?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
  );
  const shows = props.includes("repo_root");
  if (shows === mode.local) {
    throw new Error(
      `repo_root should be ${mode.local ? "hidden locally" : "offered remotely"}, but properties were: ${props.join(", ")}`,
    );
  }
  console.log("repo_root advertised:", shows);

  const text = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return (r.content as { text: string }[])[0].text;
  };

  console.log("\n--- the agent starts with only a working directory ---");
  const fresh = JSON.parse(
    await text("create_task", {
      cwd: SCRATCH,
      title: "SMOKE: captured without being told the project",
      body: "The agent only knew its working directory.",
      model: MODEL,
      // Remote cannot walk up looking for a .git, so the agent says where it is.
      ...(mode.local ? {} : { repo_root: SCRATCH }),
    }),
  );
  console.log("project_created:", fresh.project_created, "| slug:", fresh.project.slug);
  const taskId = fresh.task.id;

  console.log("\n--- a nested file path resolves to the same project ---");
  const again = JSON.parse(
    await text("create_task", {
      cwd: `${SCRATCH}/src/deep/file.ts`,
      title: "SMOKE: second capture",
      model: MODEL,
      ...(mode.local ? {} : { repo_root: SCRATCH }),
    }),
  );
  console.log("project_created:", again.project_created, "| slug:", again.project.slug);
  if (again.project.slug !== fresh.project.slug)
    throw new Error("a nested path should resolve to the project it sits in");

  console.log("\n--- write path ---");
  await text("update_task", { task_id: taskId, status: "doing", model: MODEL });
  await text("log_entry", {
    task_id: taskId,
    kind: "dead_end",
    body: "SMOKE: tried X, it did not work because Y.",
    model: MODEL,
  });
  await text("update_task", { task_id: taskId, status: "done", model: MODEL });
  const full = JSON.parse(await text("get_task", { task_id: taskId }));
  console.log("status:", full.status, "| entries:", full.entries.length);

  console.log("\n--- linked files ---");
  const marker = join(SCRATCH, "package.json");
  await text("link_files", {
    task_id: taskId,
    paths: [
      {
        path: marker,
        note: "SMOKE",
        // Locally the process hashes it and the schema does not even offer the
        // field. Remotely the agent is the one with the file, which is the
        // whole reason staleness can work over HTTP at all.
        ...(mode.local ? {} : { hash: sha256(marker) }),
      },
    ],
  });
  const linked = JSON.parse(await text("get_task", { task_id: taskId }));
  const refId = linked.files[0].id;
  const status = linked.files[0].status;

  // Locally the process reads the file on the way through, so the answer is
  // already there. Remotely the server has been told a hash but nobody has
  // looked since -- and "not checked" is what it must say until somebody has.
  const first = mode.local ? "fresh" : "unknown";
  if (status !== first)
    throw new Error(`linked file should read ${first} in ${mode.label}, got ${status}`);
  console.log("straight after linking:", status);

  if (!mode.local) {
    // The remote half of the loop, which had no tool at all: the agent hashes
    // what it was handed and reports back. Without it every hosted ref stayed
    // "unknown" for ever and the staleness feature never ran.
    await text("report_file_hashes", { refs: [{ id: refId, hash: sha256(marker) }] });
    const seen = JSON.parse(await text("get_task", { task_id: taskId }));
    if (seen.files[0].status !== "fresh")
      throw new Error(`after reporting, remote should read fresh, got ${seen.files[0].status}`);
    console.log("after the agent reported:", seen.files[0].status);
  }

  console.log("\n--- and an edit is caught ---");
  writeFileSync(marker, '{"name":"smoke-repo","edited":true}\n');
  if (!mode.local)
    await text("report_file_hashes", { refs: [{ id: refId, hash: sha256(marker) }] });

  const rechecked = JSON.parse(await text("get_task", { task_id: taskId }));
  const after = rechecked.files[0].status;
  if (after !== "changed")
    throw new Error(`an edited file should read changed in ${mode.label}, got ${after}`);
  console.log("after editing the file:", after);
  writeFileSync(marker, '{"name":"smoke-repo"}\n');

  console.log("\n--- report sees it ---");
  const md = await text("activity_report", {
    period: "today",
    format: "markdown",
    ...(mode.local ? {} : { tz: "Europe/Istanbul" }),
  });
  console.log(md.split("\n").slice(0, 5).join("\n"));

  await client.close();
}

async function main() {
  if (!(await fetch(URL_BASE).catch(() => null))) {
    console.error(
      `todox is not answering at ${URL_BASE}. Start it (pnpm dev) or set TODOX_URL.`,
    );
    process.exit(1);
  }

  mkdirSync(join(SCRATCH, "src", "deep"), { recursive: true });
  writeFileSync(join(SCRATCH, "package.json"), '{"name":"smoke-repo"}\n');

  const user = await ensureUser("smoke-agent", "Smoke");
  const { token } = await createApiToken(user.id, "mcp-smoke");

  for (const mode of MODES) await runSuite(mode, token);

  const rpc = (bearer: string | null, body: unknown) =>
    fetch(new URL("/api/rpc", URL_BASE), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

  // Compared normalised, because that is how it was stored: a root path
  // arriving from a Windows agent has its separators folded on the way in, so
  // `C:\…\todox-smoke-repo` is on file as `C:/…/todox-smoke-repo`. Comparing
  // the raw string found nothing here and everything on Linux, which is the
  // narrowest possible way for a suite to lie about what it covers.
  const scratch = normalisePath(SCRATCH);
  const project = (await projectsRepo.list(user.id, true)).find(
    (p) => p.root_path && normalisePath(p.root_path) === scratch,
  );
  if (!project) throw new Error(`the smoke project for ${scratch} was never registered`);

  const anyTask = (await tasksRepo.listByProject(project.id, "all"))[0];

  console.log("\n--- another account cannot touch this task ---");
  const intruder = await ensureUser("smoke-intruder", "Intruder");
  const intruderToken = (await createApiToken(intruder.id, "mcp-smoke")).token;
  const denied = await rpc(intruderToken, {
    method: "getTask",
    params: { task_id: anyTask.id },
  });
  console.log(denied.status, (await denied.json()).error);

  console.log("\n--- an unauthenticated call is refused, on both surfaces ---");
  const anon = await rpc(null, { method: "listProjects" });
  console.log("/api/rpc:", anon.status, (await anon.json()).error);

  const anonMcp = await fetch(new URL("/api/mcp", URL_BASE), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  // An HTML body here means the proxy redirected us to /login instead of
  // letting the endpoint answer -- the failure mode that reads as a broken
  // server rather than a refusal.
  const ct = anonMcp.headers.get("content-type") ?? "";
  if (!ct.includes("application/json"))
    throw new Error(`/api/mcp answered ${anonMcp.status} as ${ct}; is it in proxy.ts PUBLIC?`);
  console.log("/api/mcp:", anonMcp.status, (await anonMcp.json()).error?.message);

  // leave no trace
  for (const p of await projectsRepo.list(user.id, true)) {
    for (const t of await tasksRepo.listByProject(p.id, "all"))
      if (t.title.startsWith("SMOKE:")) await tasksRepo.remove(t.id);
    if (p.root_path === SCRATCH) await projectsRepo.remove(user.id, p.id);
  }
  rmSync(SCRATCH, { recursive: true, force: true });

  console.log("\nOK (cleaned up)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
