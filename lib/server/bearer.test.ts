import { describe, expect, it } from "vitest";

import { bearerToken } from "./bearer";

const headers = (authorization?: string) =>
  new Headers(authorization === undefined ? {} : { authorization });

/**
 * Three routes parsed `Authorization` inline and all three required the
 * scheme. A gateway that forwards a configured value as the whole header
 * cannot add one, so a token sent that way was refused as "missing bearer
 * token" -- with the token right there in the header.
 */
describe("bearerToken", () => {
  it("reads the documented form", () => {
    expect(bearerToken(headers("Bearer todox_abc"))).toBe("todox_abc");
    expect(bearerToken(headers("Bearer   todox_abc  "))).toBe("todox_abc");
  });

  it("reads the bare form a gateway sends, because the prefix says what it is", () => {
    expect(bearerToken(headers("todox_abc"))).toBe("todox_abc");
    expect(bearerToken(headers("  todox_abc "))).toBe("todox_abc");
  });

  it("refuses a header that carries neither the scheme nor the prefix", () => {
    // A stray value is not a token, and must not be looked up as one.
    expect(bearerToken(headers("abc"))).toBe("");
    expect(bearerToken(headers("Basic dXNlcjpwYXNz"))).toBe("");
    expect(bearerToken(headers("Bearer "))).toBe("");
    expect(bearerToken(headers(""))).toBe("");
    expect(bearerToken(headers())).toBe("");
  });

  it("does not let the scheme's case drift", () => {
    // `bearer todox_…` is what a hand-typed curl sends; the RFC says the
    // scheme is case-insensitive, the prefix rule catches it anyway.
    expect(bearerToken(headers("bearer todox_abc"))).toBe("");
  });
});
