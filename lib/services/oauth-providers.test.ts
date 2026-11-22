import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OAuthExchangeError,
  authorizationUrl,
  codeChallenge,
  enabledProviders,
  profileFromCode,
} from "./oauth-providers";

/** The provider side, against a fake `fetch`: nothing here leaves the machine. */
beforeEach(() => {
  vi.stubEnv("TODOX_PUBLIC_URL", "https://todox.test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
  vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
});
afterEach(() => vi.unstubAllEnvs());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const idToken = (claims: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("which providers are on", () => {
  it("needs both halves of the credentials", () => {
    expect(enabledProviders()).toEqual(["google", "github"]);
    vi.stubEnv("GITHUB_CLIENT_SECRET", "");
    expect(enabledProviders()).toEqual(["google"]);
    expect(authorizationUrl("github", { state: "s", codeVerifier: "v" })).toBeNull();
  });
});

describe("authorizationUrl", () => {
  it("carries the state, the PKCE challenge and our own callback", () => {
    const url = new URL(authorizationUrl("google", { state: "st", codeVerifier: "verifier" })!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe(codeChallenge("verifier"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://todox.test/api/auth/google/callback");
    // The verifier itself never goes to the browser.
    expect(url.toString()).not.toContain("verifier");
  });
});

describe("Google", () => {
  const claims = {
    iss: "https://accounts.google.com",
    aud: "google-client",
    sub: "g-1",
    email: "ada@example.com",
    email_verified: true,
    name: "Ada",
  };

  it("reads who signed in from the ID token", async () => {
    const fetcher = vi.fn(async () => json({ id_token: idToken(claims), access_token: "a" }));
    const profile = await profileFromCode("google", { code: "c", codeVerifier: "v" }, fetcher);
    expect(profile).toEqual({
      providerUserId: "g-1",
      email: "ada@example.com",
      isEmailVerified: true,
      name: "Ada",
      usernameHint: "ada",
    });
  });

  it("refuses a token minted for another client", async () => {
    const fetcher = vi.fn(async () => json({ id_token: idToken({ ...claims, aud: "someone-else" }) }));
    await expect(profileFromCode("google", { code: "c", codeVerifier: "v" }, fetcher)).rejects.toBeInstanceOf(
      OAuthExchangeError,
    );
  });

  it("does not call an address verified unless Google says so", async () => {
    const fetcher = vi.fn(async () => json({ id_token: idToken({ ...claims, email_verified: "true" }) }));
    const profile = await profileFromCode("google", { code: "c", codeVerifier: "v" }, fetcher);
    expect(profile.isEmailVerified).toBe(false);
  });

  it("turns a refused exchange into an exchange error", async () => {
    const fetcher = vi.fn(async () => json({ error: "invalid_grant" }, 400));
    await expect(profileFromCode("google", { code: "c", codeVerifier: "v" }, fetcher)).rejects.toBeInstanceOf(
      OAuthExchangeError,
    );
  });
});

describe("GitHub", () => {
  const github = (emails: unknown) =>
    vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/access_token")) return json({ access_token: "gho_x" });
      if (href.endsWith("/user")) return json({ id: 42, login: "octocat", name: "Octo Cat" });
      return json(emails);
    });

  it("takes the primary address, and only a verified one", async () => {
    const profile = await profileFromCode(
      "github",
      { code: "c", codeVerifier: "v" },
      github([
        { email: "other@example.com", primary: false, verified: true },
        { email: "octo@example.com", primary: true, verified: true },
      ]),
    );
    expect(profile).toEqual({
      providerUserId: "42",
      email: "octo@example.com",
      isEmailVerified: true,
      name: "Octo Cat",
      usernameHint: "octocat",
    });
  });

  it("has no address when the primary one is unverified", async () => {
    const profile = await profileFromCode(
      "github",
      { code: "c", codeVerifier: "v" },
      github([{ email: "octo@example.com", primary: true, verified: false }]),
    );
    expect(profile.email).toBeNull();
    expect(profile.isEmailVerified).toBe(false);
  });
});
