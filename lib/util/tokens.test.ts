import { describe, expect, it } from "vitest";

import {
  API_TOKEN_PREFIX,
  hashToken,
  newApiToken,
  newSessionToken,
  tokenPreview,
} from "./tokens";

/**
 * Session and agent secrets. Only their SHA-256 is stored, so losing the
 * database must not mean losing every live session and every agent credential.
 */
describe("newSessionToken", () => {
  it("is long enough to be worth generating randomly", () => {
    // 32 bytes as base64url: no padding, url-safe alphabet.
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, newSessionToken));
    expect(seen.size).toBe(200);
  });
});

describe("newApiToken", () => {
  it("carries the prefix the docs and the installers look for", () => {
    // `todox_…` is what the Account page shows, what the install CLI validates
    // and what a user recognises in a config file.
    expect(newApiToken().startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(API_TOKEN_PREFIX).toBe("todox_");
  });

  it("is random after the prefix", () => {
    const seen = new Set(Array.from({ length: 200 }, newApiToken));
    expect(seen.size).toBe(200);
  });

  it("uses only characters that survive a header, a URL and a TOML string", () => {
    // It travels in an Authorization header and in five different config
    // formats; base64url is the alphabet that needs no escaping in any of them.
    for (let i = 0; i < 50; i++) {
      expect(newApiToken()).toMatch(/^todox_[A-Za-z0-9_-]+$/);
    }
  });
});

describe("hashToken", () => {
  it("is a hex sha256, so the column can be fixed width and indexed", () => {
    expect(hashToken("todox_abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable, or every stored token stops matching", () => {
    expect(hashToken("todox_abc")).toBe(hashToken("todox_abc"));
  });

  it("separates tokens that differ by one character", () => {
    expect(hashToken("todox_abc")).not.toBe(hashToken("todox_abd"));
  });

  it("never returns the token it was given", () => {
    const token = newApiToken();
    expect(hashToken(token)).not.toContain(token.slice(API_TOKEN_PREFIX.length));
  });
});

describe("tokenPreview", () => {
  it("shows enough of a real token to recognise it", () => {
    const token = newApiToken();
    const preview = tokenPreview(token);
    expect(preview.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(preview).toContain("…");
    expect(preview.endsWith(token.slice(-4))).toBe(true);
  });

  it("never contains the whole token", () => {
    // The failure this guards is the one the install CLI's own masking had: at
    // a short enough length the first slice and the last slice are the entire
    // string, and the "preview" prints the credential. Real tokens are 38
    // characters, so today only a caller passing something else could reach it
    // — and a preview helper is exactly the thing that gets reused.
    for (let i = 0; i < 50; i++) {
      const token = newApiToken();
      expect(tokenPreview(token)).not.toContain(token);
    }
  });

  it("hides most of the secret", () => {
    const token = newApiToken();
    const secret = token.slice(API_TOKEN_PREFIX.length);
    const shown = tokenPreview(token).replace(API_TOKEN_PREFIX, "").split("…");
    expect(shown.join("").length).toBeLessThan(secret.length / 2);
  });
});
