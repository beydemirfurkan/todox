import { afterEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock("./server/log", () => log);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  log.logWarn.mockClear();
});

const load = async () => (await import("./public-url")).publicUrl;

describe("publicUrl", () => {
  it("strips trailing slashes, because callers append a path", async () => {
    vi.stubEnv("TODOX_PUBLIC_URL", "https://todo.example.com//");
    expect((await load())()).toBe("https://todo.example.com");
  });

  it("treats an empty value as unset", async () => {
    vi.stubEnv("TODOX_PUBLIC_URL", "  ");
    expect((await load())()).toBe("http://localhost:3000");
  });

  it("warns once in production when unset, since localhost links look like they work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TODOX_PUBLIC_URL", "");
    const publicUrl = await load();
    publicUrl();
    publicUrl();
    expect(log.logWarn).toHaveBeenCalledTimes(1);
    expect(log.logWarn).toHaveBeenCalledWith("publicUrl.notConfigured", expect.any(Object));
  });

  it("stays quiet in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TODOX_PUBLIC_URL", "");
    (await load())();
    expect(log.logWarn).not.toHaveBeenCalled();
  });
});
