import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The authorisation server's sequencing, with the database mocked: which
 * statements a grant writes together, and what a replayed or revoked token
 * ends. The SQL itself is exercised by `pnpm smoke:auth` against Postgres.
 */

const apiTokens = vi.hoisted(() => ({
  create: vi.fn(),
  createGrantStmt: vi.fn(() => ({ text: "create grant", params: [] })),
  rotateGrantStmt: vi.fn(() => ({ text: "rotate grant", params: [] })),
  removeGrantStmt: vi.fn(() => ({ text: "remove grant", params: [] })),
  findGrant: vi.fn(),
  findForUser: vi.fn(),
  findByToken: vi.fn(),
  remove: vi.fn(),
}));
const codes = vi.hoisted(() => ({ create: vi.fn(), consume: vi.fn(), pruneOlderThan: vi.fn() }));
const refresh = vi.hoisted(() => ({
  createStmt: vi.fn(() => ({ text: "create refresh", params: [] })),
  consume: vi.fn(),
  find: vi.fn(),
  revokeFamilyStmt: vi.fn(() => ({ text: "revoke family", params: [] })),
  pruneOlderThan: vi.fn(),
}));
const clients = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn() }));
const db = vi.hoisted(() => ({ tx: vi.fn() }));
const fetcher = vi.hoisted(() => ({ fetchClientMetadata: vi.fn() }));

vi.mock("../repositories/api-tokens", () => apiTokens);
vi.mock("../repositories/oauth-codes", () => codes);
vi.mock("../repositories/oauth-refresh-tokens", () => refresh);
vi.mock("../repositories/oauth-clients", () => clients);
vi.mock("../db/client", () => db);
vi.mock("../server/fetch-client-metadata", () => fetcher);
vi.mock("../public-url", () => ({ publicUrl: () => "https://www.todox.dev" }));
vi.mock("../server/log", () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));

import {
  approve,
  checkAuthorization,
  exchangeCode,
  refreshGrant,
  resolveClient,
  revokeFromAccount,
} from "./oauth-server";

const SITE = "https://www.todox.dev";
const VERIFIER = "v".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const DCR = {
  client_id: "mcp_abc",
  kind: "dcr",
  client_name: "Cursor",
  redirect_uris: ["cursor://anysphere/cb"],
  created_at: "2026-11-23T00:00:00.000Z",
  fetched_at: null,
};
const CODE_ROW = {
  client_id: "mcp_abc",
  user_id: 7,
  redirect_uri: "cursor://anysphere/cb",
  code_challenge: CHALLENGE,
  resource: "https://www.todox.dev/api/mcp",
};
const exchange = (over: Record<string, string> = {}) =>
  exchangeCode({
    code: "the-code",
    code_verifier: VERIFIER,
    client_id: "mcp_abc",
    redirect_uri: "cursor://anysphere/cb",
    ...over,
  });
const written = () => (db.tx.mock.calls[0]?.[0] as { text: string }[] | undefined)?.map((s) => s.text);

beforeEach(() => {
  vi.clearAllMocks();
  codes.pruneOlderThan.mockResolvedValue(0);
  refresh.pruneOlderThan.mockResolvedValue(0);
  db.tx.mockResolvedValue([]);
  clients.find.mockResolvedValue(DCR);
});

describe("who a client is", () => {
  it("knows the CLI without asking anything", async () => {
    expect(await resolveClient("todox-cli")).toMatchObject({ kind: "first_party" });
    expect(clients.find).not.toHaveBeenCalled();
  });

  it("only takes a stored row as a registered client if it was registered", async () => {
    clients.find.mockResolvedValue({ ...DCR, kind: "cimd" });
    expect(await resolveClient("mcp_abc")).toBeNull();
  });

  it("uses a metadata document it fetched today without fetching it again", async () => {
    const id = "https://claude.ai/oauth/meta";
    clients.find.mockResolvedValue({ ...DCR, client_id: id, kind: "cimd", fetched_at: new Date().toISOString() });
    expect(await resolveClient(id)).toMatchObject({ client_id: id });
    expect(fetcher.fetchClientMetadata).not.toHaveBeenCalled();
  });

  it("fetches and stores a document it has not seen", async () => {
    const id = "https://claude.ai/oauth/meta";
    clients.find.mockResolvedValue(undefined);
    fetcher.fetchClientMetadata.mockResolvedValue({
      client_id: id,
      client_name: "Claude Code",
      redirect_uris: ["http://localhost/callback"],
    });
    expect(await resolveClient(id)).toMatchObject({ kind: "cimd", client_name: "Claude Code" });
    expect(clients.upsert).toHaveBeenCalledWith(expect.objectContaining({ client_id: id }));
  });
});

describe("checking an authorisation request", () => {
  const query = {
    client_id: "mcp_abc",
    redirect_uri: "cursor://anysphere/cb",
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
  };

  it("never redirects to a URI the client did not register", async () => {
    expect(await checkAuthorization({ ...query, redirect_uri: "https://evil.example/cb" }, SITE)).toMatchObject({
      kind: "invalid",
    });
  });

  it("sends a bad request back to a registered redirect, with iss", async () => {
    const outcome = await checkAuthorization({ ...query, code_challenge_method: "plain", state: "s1" }, SITE);
    expect(outcome.kind).toBe("redirect");
    const url = new URL((outcome as { url: string }).url);
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("iss")).toBe("https://www.todox.dev");
  });

  it("names the host the request arrived on, in iss and in the resource", async () => {
    const outcome = await checkAuthorization(query, "https://todox.dev");
    if (outcome.kind !== "ok") throw new Error(`expected ok, got ${outcome.kind}`);
    expect(outcome.request.resource).toBe("https://todox.dev/api/mcp");
    const url = new URL(await approve(7, outcome.request, "https://todox.dev"));
    expect(url.searchParams.get("iss")).toBe("https://todox.dev");
  });

  it("approves into a code bound to the challenge", async () => {
    const outcome = await checkAuthorization(query, SITE);
    if (outcome.kind !== "ok") throw new Error(`expected ok, got ${outcome.kind}`);
    const url = new URL(await approve(7, outcome.request, SITE));
    expect(url.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codes.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7, code_challenge: CHALLENGE, client_id: "mcp_abc" }),
    );
  });
});

describe("exchanging a code", () => {
  it("refuses a code that is spent, expired or unknown", async () => {
    codes.consume.mockResolvedValue(undefined);
    expect(await exchange()).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("refuses the wrong verifier, client or redirect", async () => {
    codes.consume.mockResolvedValue(CODE_ROW);
    expect(await exchange({ code_verifier: "w".repeat(64) })).toMatchObject({ ok: false });
    expect(await exchange({ client_id: "mcp_other" })).toMatchObject({ ok: false });
    expect(await exchange({ redirect_uri: "cursor://anysphere/other" })).toMatchObject({ ok: false });
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("writes the access token and the refresh token together", async () => {
    codes.consume.mockResolvedValue(CODE_ROW);
    const result = await exchange();
    expect(result).toMatchObject({ ok: true, body: { token_type: "Bearer", expires_in: 3600 } });
    if (!result.ok) throw new Error("expected a grant");
    expect(result.body.access_token).toMatch(/^todox_/);
    expect(result.body.refresh_token).toMatch(/^todoxr_/);
    expect(written()).toEqual(["create grant", "create refresh"]);
  });

  it("gives the CLI login a personal token named after the machine, with no refresh", async () => {
    codes.consume.mockResolvedValue({ ...CODE_ROW, client_id: "todox-cli", redirect_uri: "http://127.0.0.1:5000/callback" });
    const result = await exchange({
      client_id: "todox-cli",
      redirect_uri: "http://127.0.0.1:5000/callback",
      device_name: "furkan-laptop",
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a token");
    expect(result.body.refresh_token).toBeUndefined();
    expect(apiTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "todox-mcp login · furkan-laptop", client_id: "todox-cli" }),
    );
  });
});

describe("refreshing", () => {
  const SPENT = { family_id: "fam", client_id: "mcp_abc", user_id: 7, resource: "r", used_at: "x", revoked_at: null };

  it("rotates the access token in place and issues the next refresh token", async () => {
    refresh.consume.mockResolvedValue(SPENT);
    apiTokens.findGrant.mockResolvedValue({ id: 1 });
    expect(await refreshGrant({ refresh_token: "todoxr_a", client_id: "mcp_abc" })).toMatchObject({ ok: true });
    expect(written()).toEqual(["rotate grant", "create refresh"]);
  });

  it("ends the whole grant when a used refresh token comes back", async () => {
    refresh.consume.mockResolvedValue(undefined);
    refresh.find.mockResolvedValue(SPENT);
    expect(await refreshGrant({ refresh_token: "todoxr_a", client_id: "mcp_abc" })).toMatchObject({
      ok: false,
      error: "invalid_grant",
    });
    expect(written()).toEqual(["remove grant", "revoke family"]);
  });

  it("does not revive a grant the person revoked", async () => {
    refresh.consume.mockResolvedValue(SPENT);
    apiTokens.findGrant.mockResolvedValue(undefined);
    expect(await refreshGrant({ refresh_token: "todoxr_a", client_id: "mcp_abc" })).toMatchObject({ ok: false });
    expect(written()).toEqual(["remove grant", "revoke family"]);
  });

  it("ends the grant when another client presents its token", async () => {
    refresh.consume.mockResolvedValue(SPENT);
    expect(await refreshGrant({ refresh_token: "todoxr_a", client_id: "mcp_evil" })).toMatchObject({ ok: false });
    expect(written()).toEqual(["remove grant", "revoke family"]);
  });
});

describe("revoking from the account page", () => {
  it("ends a client's whole grant", async () => {
    apiTokens.findForUser.mockResolvedValue({ id: 3, family_id: "fam" });
    await revokeFromAccount(3, 7);
    expect(written()).toEqual(["remove grant", "revoke family"]);
  });

  it("deletes a personal token by itself", async () => {
    apiTokens.findForUser.mockResolvedValue({ id: 3, family_id: null });
    await revokeFromAccount(3, 7);
    expect(apiTokens.remove).toHaveBeenCalledWith(3, 7);
    expect(db.tx).not.toHaveBeenCalled();
  });
});
