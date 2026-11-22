import { describe, expect, it } from "vitest";

import { parseHookArgs } from "./cli";

describe("todox-mcp hook arguments", () => {
  it("reads the subcommand and both flag spellings", () => {
    expect(parseHookArgs(["install", "--token", "todox_t", "--url=http://x", "--repo", "/r"])).toEqual({
      command: "install",
      flags: { token: "todox_t", url: "http://x", repo: "/r" },
    });
  });

  it("refuses an unknown flag or a flag with no value", () => {
    expect(() => parseHookArgs(["install", "--force"])).toThrow(/unknown argument --force/);
    expect(() => parseHookArgs(["install", "--token"])).toThrow(/--token needs a value/);
  });
});
