import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { authorizeUrl, CLIENT_ID, newPkce, serverFrom } from "./login";

describe("todox-mcp login", () => {
  it("makes an S256 pair whose challenge is the verifier's hash", () => {
    const { verifier, challenge } = newPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("asks the consent page for a code bound to the loopback port and the MCP resource", () => {
    const url = new URL(
      authorizeUrl({
        server: "https://www.todox.dev",
        redirectUri: "http://127.0.0.1:51234/callback",
        challenge: "c".repeat(43),
        state: "s",
      }),
    );
    expect(url.pathname).toBe("/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: "http://127.0.0.1:51234/callback",
      response_type: "code",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      state: "s",
      resource: "https://www.todox.dev/api/mcp",
    });
  });

  it("takes the server from --url, then TODOX_URL, then the hosted one", () => {
    expect(serverFrom(["--url", "https://todox.example/"], {})).toBe("https://todox.example");
    expect(serverFrom([], { TODOX_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(serverFrom([], {})).toBe("https://www.todox.dev");
  });
});
