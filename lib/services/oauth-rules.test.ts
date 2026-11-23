import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  acceptedResources,
  authorizationServerMetadata,
  baseForHost,
  checkAuthorizeQuery,
  isAcceptableRedirect,
  isMetadataClientId,
  parseClientMetadataDocument,
  parseRegistrationRequest,
  redirectMatches,
  redirectWith,
  siteOrigins,
  verifierMatches,
} from "./oauth-rules";

const BASE = "https://www.todox.dev";
const VERIFIER = "a".repeat(43) + "-._~xyz";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("PKCE", () => {
  it("accepts the verifier its challenge was made from", () => {
    expect(verifierMatches(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("refuses another verifier, a short one, and a plain challenge", () => {
    expect(verifierMatches("b".repeat(50), CHALLENGE)).toBe(false);
    expect(verifierMatches("short", CHALLENGE)).toBe(false);
    // `plain` would mean the challenge *is* the verifier.
    expect(verifierMatches(VERIFIER, VERIFIER)).toBe(false);
  });
});

describe("redirect URIs a client may register", () => {
  it("accepts https, loopback http and an app scheme", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "http://127.0.0.1:33418/callback",
      "http://localhost/callback",
      "http://[::1]:9000/cb",
      "cursor://anysphere.cursor-retrieval/oauth/callback",
    ])
      expect(isAcceptableRedirect(ok), ok).toBe(true);
  });

  it("refuses plain http elsewhere, script schemes and fragments", () => {
    for (const bad of [
      "http://evil.example/callback",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "https://claude.ai/cb#frag",
      "not a url",
    ])
      expect(isAcceptableRedirect(bad), bad).toBe(false);
  });
});

describe("matching a redirect against the registered ones", () => {
  it("is an exact match", () => {
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb")).toBe(true);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb2")).toBe(false);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb?x=1")).toBe(false);
  });

  it("lets a loopback redirect come back on any port, and only that", () => {
    const registered = ["http://127.0.0.1/callback"];
    expect(redirectMatches(registered, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectMatches(registered, "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectMatches(registered, "http://localhost:51234/callback")).toBe(false);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example:8443/cb")).toBe(false);
  });
});

describe("client metadata documents", () => {
  const URL_ID = "https://claude.ai/oauth/claude-code-client-metadata";

  it("recognises a client id that is a document's address", () => {
    expect(isMetadataClientId(URL_ID)).toBe(true);
    expect(isMetadataClientId("https://claude.ai/")).toBe(false);
    expect(isMetadataClientId("http://claude.ai/meta")).toBe(false);
    expect(isMetadataClientId("mcp_abc")).toBe(false);
  });

  it("takes a document that names itself by the URL it came from", () => {
    expect(
      parseClientMetadataDocument(URL_ID, {
        client_id: URL_ID,
        client_name: "Claude Code",
        redirect_uris: ["http://localhost/callback"],
        token_endpoint_auth_method: "none",
      }),
    ).toEqual({ client_name: "Claude Code", redirect_uris: ["http://localhost/callback"] });
  });

  it("refuses one that claims to be another client", () => {
    expect(
      parseClientMetadataDocument(URL_ID, {
        client_id: "https://other.example/meta",
        redirect_uris: ["http://localhost/callback"],
      }),
    ).toBeNull();
  });

  it("refuses a confidential client, an unsafe redirect, or no redirect", () => {
    const base = { client_id: URL_ID, redirect_uris: ["http://localhost/cb"] };
    expect(parseClientMetadataDocument(URL_ID, { ...base, token_endpoint_auth_method: "private_key_jwt" })).toBeNull();
    expect(parseClientMetadataDocument(URL_ID, { ...base, redirect_uris: ["javascript:alert(1)"] })).toBeNull();
    expect(parseClientMetadataDocument(URL_ID, { ...base, redirect_uris: [] })).toBeNull();
    expect(parseClientMetadataDocument(URL_ID, null)).toBeNull();
  });

  it("names a client with no name after its host", () => {
    expect(parseClientMetadataDocument(URL_ID, { client_id: URL_ID, redirect_uris: ["https://claude.ai/cb"] }))
      .toMatchObject({ client_name: "claude.ai" });
  });
});

describe("dynamic registration requests", () => {
  it("keeps the redirects and a bounded name", () => {
    expect(
      parseRegistrationRequest({ client_name: "x".repeat(300), redirect_uris: ["cursor://a/cb"] }),
    ).toEqual({ client_name: "x".repeat(100), redirect_uris: ["cursor://a/cb"] });
  });

  it("refuses eleven redirects, or one that is not a string", () => {
    expect(parseRegistrationRequest({ redirect_uris: Array(11).fill("https://a.example/cb") })).toBeNull();
    expect(parseRegistrationRequest({ redirect_uris: [42] })).toBeNull();
    expect(parseRegistrationRequest([])).toBeNull();
  });
});

describe("the authorisation request", () => {
  const input = { clientId: "c", redirectUri: "https://a.example/cb", base: BASE };
  const good = {
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    resource: `${BASE}/api/mcp`,
  };

  it("binds a good request to the MCP endpoint", () => {
    expect(checkAuthorizeQuery(good, input)).toEqual({
      ok: true,
      request: {
        client_id: "c",
        redirect_uri: "https://a.example/cb",
        code_challenge: CHALLENGE,
        state: "xyz",
        resource: `${BASE}/api/mcp`,
      },
    });
  });

  it("accepts the other host form and a missing resource", () => {
    expect(checkAuthorizeQuery({ ...good, resource: "https://todox.dev/api/mcp" }, input).ok).toBe(true);
    expect(checkAuthorizeQuery({ ...good, resource: null }, input).ok).toBe(true);
  });

  it("refuses another resource, plain PKCE, no challenge, or a token response", () => {
    expect(checkAuthorizeQuery({ ...good, resource: "https://evil.example/api/mcp" }, input)).toMatchObject({
      ok: false,
      error: "invalid_target",
    });
    expect(checkAuthorizeQuery({ ...good, code_challenge_method: "plain" }, input)).toMatchObject({ ok: false });
    expect(checkAuthorizeQuery({ ...good, code_challenge: null }, input)).toMatchObject({ ok: false });
    expect(checkAuthorizeQuery({ ...good, response_type: "token" }, input)).toMatchObject({
      ok: false,
      error: "unsupported_response_type",
    });
  });
});

describe("which origin a request reached", () => {
  it("answers with the host the client used, when it is one of ours", () => {
    expect(baseForHost("https://todox.dev", "www.todox.dev")).toBe("https://www.todox.dev");
    expect(baseForHost("https://todox.dev", "todox.dev")).toBe("https://todox.dev");
    expect(baseForHost("https://www.todox.dev", "TODOX.DEV")).toBe("https://todox.dev");
    // x-forwarded-host may carry a list; the first is the client's.
    expect(baseForHost("https://todox.dev", "www.todox.dev, internal:3000")).toBe("https://www.todox.dev");
  });

  it("never lets a host header name somebody else's origin", () => {
    expect(baseForHost("https://todox.dev", "evil.example")).toBe("https://todox.dev");
    expect(baseForHost("https://todox.dev", "todox.dev.evil.example")).toBe("https://todox.dev");
    expect(baseForHost("https://todox.dev", "10.0.0.5:3000")).toBe("https://todox.dev");
    expect(baseForHost("https://todox.dev", null)).toBe("https://todox.dev");
  });
});

describe("site identity", () => {
  it("knows both host forms", () => {
    expect(siteOrigins(BASE)).toEqual(["https://www.todox.dev", "https://todox.dev"]);
    expect(acceptedResources("https://todox.dev")).toContain("https://www.todox.dev/api/mcp");
  });

  it("advertises S256, metadata documents and the iss parameter", () => {
    expect(authorizationServerMetadata(BASE)).toMatchObject({
      issuer: BASE,
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("puts the code next to the client's own query, skipping nulls", () => {
    expect(redirectWith("http://127.0.0.1:5000/callback?x=1", { code: "abc", state: null })).toBe(
      "http://127.0.0.1:5000/callback?x=1&code=abc",
    );
  });
});
