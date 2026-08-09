/**
 * End-to-end check of the agent path as it now works: a real API token, the
 * MCP server over stdio, and the HTTP RPC endpoint behind it. Also proves the
 * two things accounts have to guarantee -- no token, no access; wrong account,
 * no access.
 *
 * Needs the web server running. Point TODOX_URL at it if it is not on :3000.
 */
import "./env";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as projectsRepo from "../lib/repositories/projects";
import * as tasksRepo from "../lib/repositories/tasks";
import * as usersRepo from "../lib/repositories/users";
import { createApiToken } from "../lib/services/auth";
import { hashPassword } from "../lib/util/password";

/** A throwaway repo the agent has never heard of, to prove auto-registration. */
const SCRATCH = join(tmpdir(), "todox-smoke-repo");
const URL_BASE = process.env.TODOX_URL ?? "http://localhost:3000";
const MODEL = "claude-opus-5";

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

  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: "pnpm",
      args: ["exec", "tsx", join(__dirname, "..", "mcp", "server.ts")],
      env: { ...process.env, TODOX_TOKEN: token, TODOX_URL: URL_BASE } as Record<
        string,
        string
      >,
    }),
  );

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));

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
    }),
  );
  console.log("project_created:", again.project_created, "| slug:", again.project.slug);

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

  console.log("\n--- report sees it ---");
  const md = await text("activity_report", { period: "today", format: "markdown" });
  console.log(md.split("\n").slice(0, 5).join("\n"));

  const rpc = (bearer: string | null, body: unknown) =>
    fetch(new URL("/api/rpc", URL_BASE), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

  console.log("\n--- another account cannot touch this task ---");
  const intruder = await ensureUser("smoke-intruder", "Intruder");
  const intruderToken = (await createApiToken(intruder.id, "mcp-smoke")).token;
  const denied = await rpc(intruderToken, {
    method: "getTask",
    params: { task_id: taskId },
  });
  console.log(denied.status, (await denied.json()).error);

  console.log("\n--- an unauthenticated call is refused ---");
  const anon = await rpc(null, { method: "listProjects" });
  console.log(anon.status, (await anon.json()).error);

  await client.close();

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
