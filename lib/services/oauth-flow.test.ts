import { describe, expect, it } from "vitest";

import {
  decodePending,
  encodePending,
  inviteTokenFromNext,
  resumablePath,
  safeNext,
  stateMatches,
} from "./oauth-flow";

describe("safeNext", () => {
  it("allows an invitation and the account page, nothing else", () => {
    const invite = `/invite?token=${"a".repeat(40)}`;
    expect(safeNext(invite)).toBe(invite);
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("/account?tab=connections")).toBe("/account?tab=connections");
    for (const bad of ["https://evil.example", "//evil.example", "/p/x", "/account?tab=a&x=1", null, ""]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("resumablePath", () => {
  it("returns to an agent's pending connection after sign-in", () => {
    const pending = "/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Fmeta&response_type=code&state=a.b~c";
    expect(resumablePath(pending)).toBe(pending);
    expect(safeNext(pending)).toBe(pending);
  });

  it("refuses anything that could leave the consent page", () => {
    for (const bad of [
      "/oauth/authorize",
      "/oauth/authorize?x=<script>",
      "/oauth/authorizeX?a=1",
      "//evil.example/oauth/authorize?a=1",
      "/oauth/authorize?a=1#frag",
      "/oauth/authorize?a=1 b",
    ])
      expect(resumablePath(bad), bad).toBeUndefined();
  });
});

describe("inviteTokenFromNext", () => {
  it("reads the token from an invitation link, and from nothing else", () => {
    const token = "a".repeat(40);
    expect(inviteTokenFromNext(`/invite?token=${token}`)).toBe(token);
    for (const bad of [
      "/invite?token=short",
      `/invite?token=${token}&then=https://evil.example`,
      `https://evil.example/invite?token=${token}`,
      "/account",
      "",
      null,
      undefined,
    ]) {
      expect(inviteTokenFromNext(bad)).toBeUndefined();
    }
  });
});

describe("the pending cookie", () => {
  const pending = { provider: "github" as const, state: "s", codeVerifier: "v", next: "/account" };

  it("round-trips", () => {
    expect(decodePending(encodePending(pending))).toEqual(pending);
  });

  it("reads garbage and tampering as no cookie", () => {
    expect(decodePending(undefined)).toBeNull();
    expect(decodePending("not base64 json")).toBeNull();
    expect(decodePending(encodePending({ ...pending, provider: "gitlab" as never }))).toBeNull();
  });

  it("re-checks where it may land", () => {
    expect(decodePending(encodePending({ ...pending, next: "https://evil.example" }))?.next).toBe("/");
  });
});

describe("stateMatches", () => {
  it("needs the exact state", () => {
    expect(stateMatches("abc", "abc")).toBe(true);
    expect(stateMatches("abc", "abd")).toBe(false);
    expect(stateMatches("abc", "ab")).toBe(false);
    expect(stateMatches("abc", null)).toBe(false);
  });
});
