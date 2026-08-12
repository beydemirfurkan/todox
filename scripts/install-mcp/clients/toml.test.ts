import { describe, expect, it } from "vitest";

import { upsertTomlServerSection } from "./toml";

const install = (text: string, url: string, headerValue: string) =>
  upsertTomlServerSection(text, "todox", {
    url,
    headerName: "Authorization",
    headerValue,
  });

describe("upsertTomlServerSection", () => {
  it("creates a section when none exists", () => {
    const out = upsertTomlServerSection("", "todox", {
      url: "https://www.todox.dev/api/mcp",
      headerName: "Authorization",
      headerValue: "Bearer abc",
    });
    expect(out.status).toBe("created");
    expect(out.text).toContain("[mcp_servers.todox]");
    expect(out.text).toContain('url = "https://www.todox.dev/api/mcp"');
    expect(out.text).toContain("[mcp_servers.todox.http_headers]");
    expect(out.text).toContain('"Authorization" = "Bearer abc"');
  });

  it("replaces an existing section in place", () => {
    const first = install("", "https://old.example/mcp", "Bearer old");
    const second = install(first.text, "https://new.example/mcp", "Bearer new");
    expect(second.status).toBe("updated");
    expect(second.text).not.toContain("old.example");
    expect(second.text).toContain("new.example");
    expect(second.text).toContain("Bearer new");
  });

  /**
   * The sub-table belongs to the entry. Stopping the replacement at the first
   * following `[` left the previous `http_headers` behind, so re-installing
   * produced two of them — a duplicate key, which no TOML parser accepts —
   * and the superseded token stayed in the file.
   */
  it("replaces the sub-table too, rather than leaving a stale copy", () => {
    const first = install("", "https://old.example/mcp", "Bearer old");
    const second = install(first.text, "https://new.example/mcp", "Bearer new");
    expect(second.text.match(/\[mcp_servers\.todox\.http_headers\]/g)).toHaveLength(1);
    expect(second.text).not.toContain("Bearer old");
  });

  it("is idempotent: installing twice over is the same as installing once", () => {
    const once = install("", "https://x/mcp", "Bearer abc");
    const twice = install(once.text, "https://x/mcp", "Bearer abc");
    expect(twice.text).toBe(once.text);
  });

  /**
   * JavaScript has no `\Z`. Written as an escape it matches a literal "Z", so
   * a section with no following `[` and no "Z" in it matched nothing at all:
   * the text came back untouched while the status still said "updated".
   */
  it("replaces a section that is the last thing in the file", () => {
    const existing = '[mcp_servers.todox]\nurl = "https://old.example/mcp"\n';
    const out = install(existing, "https://new.example/mcp", "Bearer new");
    expect(out.status).toBe("updated");
    expect(out.text).toContain("new.example");
    expect(out.text).not.toContain("old.example");
    expect(out.text).toContain('"Authorization" = "Bearer new"');
  });

  it("leaves the sections around it alone", () => {
    const existing = [
      '[model]\nname = "gpt-5"\n',
      '\n[mcp_servers.todox]\nurl = "https://old.example/mcp"\n',
      '\n[mcp_servers.todox.http_headers]\n"Authorization" = "Bearer old"\n',
      '\n[tui]\ntheme = "dark"\n',
    ].join("");
    const out = install(existing, "https://new.example/mcp", "Bearer new");
    expect(out.text).toContain('[model]\nname = "gpt-5"');
    expect(out.text).toContain('[tui]\ntheme = "dark"');
    expect(out.text).toContain("new.example");
    expect(out.text).not.toContain("Bearer old");
  });

  it("leaves another server's entry alone", () => {
    const existing = '[mcp_servers.other]\nurl = "https://other.example/mcp"\n';
    const out = install(existing, "https://x/mcp", "Bearer abc");
    expect(out.status).toBe("created");
    expect(out.text).toContain("[mcp_servers.other]");
    expect(out.text).toContain("https://other.example/mcp");
    expect(out.text).toContain("[mcp_servers.todox]");
  });

  it("does not treat a longer server name as ours", () => {
    const existing = '[mcp_servers.todoxy]\nurl = "https://other.example/mcp"\n';
    const out = install(existing, "https://x/mcp", "Bearer abc");
    expect(out.status).toBe("created");
    expect(out.text).toContain("[mcp_servers.todoxy]");
  });

  it("escapes quotes inside the header value", () => {
    const out = install("", "https://x/mcp", 'Bearer "quoted"');
    expect(out.text).toContain('Bearer \\"quoted\\"');
  });

  it("escapes backslashes inside the header value", () => {
    const out = install("", "https://x/mcp", "Bearer back\\slash");
    expect(out.text).toContain("Bearer back\\\\slash");
  });

  /**
   * `String.replace` reads `$&` in the replacement as "the whole match", which
   * spliced the section being replaced into the middle of the token.
   */
  it("does not let a $ pattern in the value be read as a substitution", () => {
    const first = install("", "https://old.example/mcp", "Bearer old");
    const out = install(first.text, "https://x/mcp", "Bearer a$&b");
    expect(out.text).toContain('"Authorization" = "Bearer a$&b"');
    expect(out.text).not.toContain("Bearer old");
  });
});
