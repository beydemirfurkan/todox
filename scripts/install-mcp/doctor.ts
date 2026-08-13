import { pathToFileURL } from "node:url";

/**
 * Standalone MCP doctor — initialize + tools/list + a get_context call
 * against a known repo. Used by the install CLI as a post-install smoke,
 * and runnable on its own for "is this server reachable from my machine?"
 * debugging. The get_context call exercises the full request/response cycle
 * (auth, schema, repository resolution) so a broken deploy fails here rather
 * than at the agent's first session.
 */
export type DoctorReport = { ok: boolean; detail: string };

const PROTOCOL = "2025-06-18";

/**
 * A transport failure is a diagnosis, not a crash. `fetch` rejects on DNS
 * failure, a refused connection or a bad certificate, and letting that
 * propagate printed a bare "fetch failed" over a config the CLI had already
 * written successfully — leaving the user unable to tell whether the install
 * had worked. Every failure this function can see comes back as a report.
 */
type RpcOutcome =
  | { ok: true; status: number; json: unknown }
  | { ok: false; detail: string };

async function rpc(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<RpcOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
  } catch (e) {
    return {
      ok: false,
      detail: `cannot reach ${url} (${e instanceof Error ? e.message : String(e)}); ` +
        "check the --url and that the server is running",
    };
  }
  return { ok: true, status: res.status, json: await res.json().catch(() => null) };
}

/**
 * HTTP statuses worth naming. 401 is the one people actually hit, and "HTTP
 * 401" does not tell them the token is the thing to replace.
 */
function explainStatus(step: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${step} rejected the token (HTTP ${status}); create a fresh one on the Account page`;
  }
  if (status === 404) {
    return `${step} got HTTP 404; the --url should end in /api/mcp`;
  }
  return `${step} HTTP ${status}`;
}

export async function runDoctor(opts: {
  url: string;
  token: string;
  cwd?: string;
}): Promise<DoctorReport> {
  const cwd = opts.cwd ?? process.cwd();

  // 1. initialize
  const init = await rpc(opts.url, opts.token, {
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "todox-install-doctor", version: "0" },
    },
  });
  if (!init.ok) return { ok: false, detail: init.detail };
  if (init.status !== 200) {
    return { ok: false, detail: explainStatus("initialize", init.status) };
  }

  // 2. tools/list
  const tools = await rpc(opts.url, opts.token, {
    id: 2,
    method: "tools/list",
  });
  if (!tools.ok) return { ok: false, detail: tools.detail };
  if (tools.status !== 200) {
    return { ok: false, detail: explainStatus("tools/list", tools.status) };
  }
  const names = (((tools.json as { result?: { tools?: Array<{ name: string }> } })?.result?.tools) ?? [])
    .map((t) => t.name);
  const required = ["get_context", "create_task", "log_entry"];
  const missing = required.filter((r) => !names.includes(r));
  if (missing.length) {
    return { ok: false, detail: `tools missing: ${missing.join(", ")}` };
  }

  // 3. get_context against the cwd. Exercises auth + schema + project lookup.
  const ctx = await rpc(opts.url, opts.token, {
    id: 3,
    method: "tools/call",
    params: { name: "get_context", arguments: { cwd, create_if_missing: false } },
  });
  if (!ctx.ok) return { ok: false, detail: ctx.detail };
  if (ctx.status !== 200) {
    return { ok: false, detail: explainStatus("get_context", ctx.status) };
  }
  const ctxBody = ctx.json as {
    result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    error?: { message?: string };
  };
  if (ctxBody.error) {
    return { ok: false, detail: `get_context error: ${ctxBody.error.message ?? "unknown"}` };
  }
  const text = ctxBody.result?.content?.[0]?.text ?? "";
  // A tool that fails reports it as `isError` on a 200 with a JSON-RPC result,
  // not as a JSON-RPC `error`. Checking only the latter meant a server that
  // said exactly what was wrong -- "the server could not complete that call",
  // which is what a rotated database password looks like from out here -- got
  // relayed as "returned non-JSON", sending the reader after the wrong thing.
  if (ctxBody.result?.isError) {
    return { ok: false, detail: `get_context failed: ${text || "no message"}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, detail: "get_context returned non-JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, detail: "get_context returned no body" };
  }

  return {
    ok: true,
    detail: `protocol=${PROTOCOL} tools=${names.length} briefing-ok`,
  };
}

// CLI shim: only run when this file is the script entry, not when imported
// from `index.ts`. `import.meta.url === pathToFileURL(process.argv[1]).href`
// is the standard tsx/Node ESM "is this the main module" check.
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const url = argv[0] ?? process.env.TODOX_URL ?? "https://www.todox.dev/api/mcp";
  const token = argv[1] ?? process.env.TODOX_TOKEN ?? "";
  const cwd = argv[2] ?? process.cwd();
  if (!token) {
    console.error(
      "[todox doctor] usage: pnpm mcp:doctor <url> <token> [cwd] (token may also come from $TODOX_TOKEN)",
    );
    process.exit(2);
  }
  const report = await runDoctor({ url, token, cwd });
  console.error(`[todox doctor] ${report.ok ? "ok" : "FAIL"} — ${report.detail}`);
  process.exit(report.ok ? 0 : 1);
}

const argv1 = process.argv[1];
if (argv1) {
  try {
    if (import.meta.url === pathToFileURL(argv1).href) {
      main().catch((e: unknown) => {
        console.error("[todox doctor]", e instanceof Error ? e.message : e);
        process.exit(1);
      });
    }
  } catch {
    // process.argv[1] may not be a file URL on every platform; skip the shim.
  }
}
