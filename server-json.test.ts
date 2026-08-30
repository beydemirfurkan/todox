import { describe, expect, it } from "vitest";
import { SERVER_INFO } from "./mcp/tools";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `server.json` is what the MCP registry and the directories that mirror it
 * read. Nothing in the app imports it, nothing renders it, and no page breaks
 * if it is wrong — it fails at publish time, or worse, publishes something
 * inaccurate and sits there being the first thing a stranger reads.
 *
 * These are the constraints from the published schema
 * (static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json),
 * asserted here rather than fetched: CI should not need the network to tell
 * whether this file is well-formed, and a registry that is down must not turn
 * into a red build.
 *
 * The 100-character description was found the way these usually are — by
 * writing 215 characters of it first and validating against the real schema
 * before publishing rather than after.
 */
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, file), "utf8")) as Record<string, unknown>;

const server = read("server.json");
const pkg = read("package.json");

const remotes = server.remotes as Array<{
  type: string;
  url: string;
  headers?: Array<{ name: string; isRequired?: boolean; isSecret?: boolean }>;
}>;

describe("the registry entry", () => {
  it("carries every field the schema requires", () => {
    for (const key of ["name", "description", "version"]) {
      expect(server[key], key).toBeTruthy();
    }
  });

  it("uses a reverse-DNS name with exactly one slash", () => {
    // The namespace is also what proves ownership at publish time: the
    // `io.github.<user>` form is the one a GitHub login can claim.
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(server.name).toBe("io.github.beydemirfurkan/todox");
  });

  it("keeps the description inside the 100 characters the schema allows", () => {
    // This is the entire listing in a directory. It is also the constraint
    // that silently rejects a publish.
    const description = server.description as string;
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(100);
  });

  it("stays on the same version as the package", () => {
    // Two files, one release. They drift the first time somebody bumps one,
    // and the registry then advertises a version that never existed.
    expect(server.version).toBe(pkg.version);
  });

  it("agrees with the version both MCP transports announce", () => {
    // The third copy, and the one a client actually sees: SERVER_INFO is what
    // `initialize` answers with on both the hosted endpoint and the stdio
    // process. It said "1.0.0" from before there was a release, so the first
    // tag shipped a server introducing itself as a version that did not exist
    // -- found by installing the v0.1.0 tarball and reading the handshake.
    //
    // It is a literal rather than a read of package.json because the stdio
    // package is a pruned tree and `scripts/pack-mcp.ts` walks its require
    // graph resolving `.js` and `index.js` only. This assertion is what stops
    // the literal drifting instead.
    expect(SERVER_INFO.version).toBe(pkg.version);
  });

  it("points at the hosted endpoint over streamable-http", () => {
    expect(remotes).toHaveLength(1);
    expect(remotes[0]!.type).toBe("streamable-http");
    expect(remotes[0]!.url).toBe("https://www.todox.dev/api/mcp");
  });

  it("asks for the token as a required secret header", () => {
    // Marked secret so a directory's setup UI masks it rather than printing
    // it back, and required so nobody is handed a config that 401s.
    const auth = remotes[0]!.headers?.find((h) => h.name === "Authorization");
    expect(auth).toBeDefined();
    expect(auth!.isRequired).toBe(true);
    expect(auth!.isSecret).toBe(true);
  });

  it("carries no token of its own", () => {
    // This file is committed and published. The header declares that a token
    // is needed; it must never carry one.
    expect(JSON.stringify(server)).not.toMatch(/todox_[A-Za-z0-9]/);
  });
});
