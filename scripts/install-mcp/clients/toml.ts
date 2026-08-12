/**
 * Append or replace a `[mcp_servers.<name>]` section. Used by the Codex
 * installer. Hand-rolled because the table we emit is small: one section
 * header, one `url` line, one `http_headers` table. Pulling in a TOML
 * dependency for that is not worth it.
 *
 * An entry is more than its own header: `[mcp_servers.<name>.http_headers]`
 * belongs to it and has to go when it is replaced. Stopping at the first
 * following `[` left the old sub-table in place, so re-installing produced a
 * duplicate key — which is not valid TOML — carrying the previous token.
 */
export function upsertTomlServerSection(
  text: string,
  name: string,
  fields: { url: string; headerName: string; headerValue: string },
): { text: string; status: "created" | "updated" } {
  const header = `[mcp_servers.${name}]`;
  const block = [
    header,
    `url = ${tomlString(fields.url)}`,
    "",
    `[mcp_servers.${name}.http_headers]`,
    `${tomlString(fields.headerName)} = ${tomlString(fields.headerValue)}`,
    "",
  ].join("\n");

  const existing = serverSectionPattern(name).exec(text);
  if (existing) {
    // Spliced rather than `String.replace`d: a `$&` or `$1` in the token would
    // otherwise be read as a substitution and paste the matched section into
    // the value.
    const before = text.slice(0, existing.index);
    const after = text.slice(existing.index + existing[0].length);
    return { text: `${before}${block.trimEnd()}\n${after}`, status: "updated" };
  }
  const sep = text.endsWith("\n") || text.length === 0 ? "" : "\n";
  return { text: text + sep + "\n" + block, status: "created" };
}

/**
 * The whole entry: its header, its body, and any `<name>.` sub-table, ending
 * at the next unrelated section or at the end of the file.
 *
 * `^` under `m` keeps the header on a line of its own, so one quoted inside a
 * value is not mistaken for the section. End of input is `(?![\s\S])` because
 * JavaScript has no `\Z` — written as an escape it matches a literal "Z", so
 * the match failed outright whenever our section was last in the file and the
 * caller was told "updated" over a config nothing had been written to.
 */
function serverSectionPattern(name: string): RegExp {
  const header = escapeRegExp(`[mcp_servers.${name}]`);
  const ownSubTable = escapeRegExp(`mcp_servers.${name}.`);
  return new RegExp(
    `^${header}[\\s\\S]*?(?=\\n\\[(?!${ownSubTable})|(?![\\s\\S]))`,
    "m",
  );
}

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
