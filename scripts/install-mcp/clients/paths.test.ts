import { describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

import { expandHome, vsCodeConfigDir } from "./paths";

/**
 * `process.platform` is read inside the function, so overriding the property
 * is enough and no module reset is needed. Restoring it is not optional:
 * vitest reuses a worker process across files, and a leaked "linux" would
 * follow this suite into the next one.
 */
function withPlatform(platform: NodeJS.Platform, body: () => void) {
  const savedPlatform = process.platform;
  const savedAppData = process.env.APPDATA;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    body();
  } finally {
    Object.defineProperty(process, "platform", {
      value: savedPlatform,
      configurable: true,
    });
    if (savedAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = savedAppData;
  }
}

describe("expandHome", () => {
  it("expands ~ on its own", () => {
    expect(expandHome("~")).toBe(os.homedir());
  });
  it("expands ~/path", () => {
    expect(expandHome("~/foo")).toBe(path.join(os.homedir(), "foo"));
  });
  it("expands the backslash form Windows users type", () => {
    expect(expandHome("~\\foo")).toBe(path.join(os.homedir(), "foo"));
  });
  it("leaves absolute paths alone", () => {
    expect(expandHome("/etc/passwd")).toBe("/etc/passwd");
  });
  it("leaves a bare ~ inside a name alone", () => {
    // Only a leading ~ is a home reference; "~backup" is a filename.
    expect(expandHome("~backup")).toBe("~backup");
  });
});

describe("vsCodeConfigDir", () => {
  it("uses APPDATA on win32", () => {
    withPlatform("win32", () => {
      process.env.APPDATA = "C:\\Users\\x\\AppData\\Roaming";
      // Built with path.join rather than compared to a hardcoded
      // "…\\Code\\User": node picks its separator from the real platform at
      // load time, not from this override, so the literal passed on the
      // Windows CI job and failed on the ubuntu one. What is being claimed
      // here is which base directory wins, not which slash node chose.
      expect(vsCodeConfigDir()).toBe(
        path.join("C:\\Users\\x\\AppData\\Roaming", "Code", "User"),
      );
    });
  });

  it("falls back to the default Roaming path when APPDATA is unset", () => {
    withPlatform("win32", () => {
      delete process.env.APPDATA;
      expect(vsCodeConfigDir()).toBe(
        path.join(os.homedir(), "AppData", "Roaming", "Code", "User"),
      );
    });
  });

  it("uses ~/.config on linux", () => {
    withPlatform("linux", () => {
      expect(vsCodeConfigDir()).toBe(path.join(os.homedir(), ".config", "Code", "User"));
    });
  });
});
