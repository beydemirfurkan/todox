import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What is being protected here is one line of output.
 *
 * With no SMTP configured the transport used to print the whole message to the
 * server log in every environment. In development that is the feature. In
 * production the message is often a password reset, and its body carries a link
 * that grants an hour of full account access -- to anyone who can read the
 * log, which on a container platform is a wider and longer-lived set of people
 * than the mailbox it was addressed to.
 *
 * Each test re-imports the module: the transport is built once and cached, so
 * a second test would otherwise get the first one's decision.
 */
const SMTP_VARS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"] as const;

const RESET_MAIL = {
  to: "someone@example.com",
  subject: "Reset your password",
  text: "Open https://todox.dev/reset?token=super-secret-value to choose a new one.",
};

async function freshMailer() {
  vi.resetModules();
  return import("./mailer");
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(SMTP_VARS.map((k) => [k, process.env[k]]));
  for (const k of SMTP_VARS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("transport with no SMTP configured", () => {
  it("prints to the log in development, which is what it is for", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { transport } = await freshMailer();
    expect(transport().name).toBe("console");
  });

  it("refuses in production instead of printing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport } = await freshMailer();
    expect(transport().name).toBe("refusing");
  });

  it("keeps the token out of the log in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { send } = await freshMailer();
    await send(RESET_MAIL);

    const everythingWritten = [...log.mock.calls, ...error.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    expect(everythingWritten).not.toContain("super-secret-value");
    // The failure itself still has to be visible, or this trades a leak for a
    // silence -- which is the bug the console transport existed to avoid.
    expect(everythingWritten).toContain("refusing");
  });

  it("does not let the refusal reach the caller", async () => {
    // `send` swallowing delivery errors is what keeps password reset from
    // answering differently for an address that exists. A refusing transport
    // must not be the one exception.
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { send } = await freshMailer();
    await expect(send(RESET_MAIL)).resolves.toBeUndefined();
  });

  it("says so once, not once per message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // Both streams: the logger sends warnings to stdout and failures to stderr,
    // which is what lets a runtime separate "look at this" from "act on this".
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { send } = await freshMailer();

    await send(RESET_MAIL);
    await send(RESET_MAIL);

    // Parsed rather than matched on a substring. These lines used to be prose
    // built from template strings, which is fine to read over a shoulder and
    // useless to anything else — and SECURITY.md says this failure "shows up
    // only in the log", so the log is the whole story. Asserting the shape is
    // asserting that a collector can still find it.
    const emitted = (spy: typeof log) =>
      spy.mock.calls.flat().map(String).map((line) => JSON.parse(line) as Record<string, unknown>);

    const configWarnings = emitted(log).filter((l) => l.event === "mail.notConfigured");
    expect(configWarnings).toHaveLength(1);

    const refusals = emitted(error).filter((l) => l.event === "mail.deliveryFailed");
    expect(refusals).toHaveLength(2);
    expect(refusals[0]!.transport).toBe("refusing");
    // The address is masked and the body never travels: a log is a place
    // secrets are kept for a long time in plain text.
    expect(JSON.stringify(refusals)).not.toContain("super-secret-value");
  });
});

describe("transport with SMTP configured", () => {
  it("uses it, and half a configuration counts as none", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "todox";

    const partial = await freshMailer();
    expect(partial.transport().name).toBe("refusing");

    process.env.SMTP_PASS = "secret";
    process.env.MAIL_FROM = "todox <noreply@example.com>";

    const full = await freshMailer();
    expect(full.transport().name).toBe("smtp");
  });
});
