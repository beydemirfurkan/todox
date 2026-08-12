/**
 * Argument parser for the install-mcp CLI. Pure function so it is trivially
 * testable; `index.ts` is the only caller and binds the parsed args to the
 * registered installers.
 *
 * Reads `process.env.TODOX_TOKEN` so a token from the environment is one
 * keystroke away; tests must therefore save and clear that variable.
 */
export type ParsedArgs = {
  client: string;
  url: string;
  token: string;
  transport: "http" | "stdio";
  dryRun: boolean;
  verbose: boolean;
};

const KNOWN_CLIENTS = ["claude-code", "codex", "cursor", "vscode", "opencode"] as const;

/**
 * Flags that never take a value. The brief's parser would otherwise consume
 * the next argv as the flag's value (so `--dry-run claude-code` would turn
 * `claude-code` into the dry-run value and lose the client name entirely).
 * Standard CLI convention is that boolean flags stay boolean regardless of
 * what follows, and `pnpm install:mcp --dry-run claude-code` is the natural
 * order for a one-shot script.
 */
const BOOLEAN_FLAGS = new Set(["dry-run", "verbose"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          flags[key] = true;
        } else {
          flags[key] = next;
          i++;
        }
      }
    } else {
      positional.push(a);
    }
  }

  const clientName = positional[0];
  if (!clientName || !(KNOWN_CLIENTS as readonly string[]).includes(clientName)) {
    throw new Error(
      `client must be one of: ${KNOWN_CLIENTS.join(", ")} (got '${clientName ?? ""}')`,
    );
  }

  const transport = typeof flags.transport === "string" ? flags.transport : "http";
  if (transport !== "http" && transport !== "stdio") {
    throw new Error(`--transport must be 'http' or 'stdio' (got '${transport}')`);
  }

  // A bare --token (no value, or followed by another flag) becomes the boolean
  // true under our parser; treating that as a token would hand `true` to the
  // installer and break the verify step. Reject it instead.
  const flagToken = flags.token;
  if (flagToken === true) {
    throw new Error("--token requires a value");
  }

  return {
    client: clientName,
    url: typeof flags.url === "string" ? flags.url : "https://www.todox.dev/api/mcp",
    token: typeof flagToken === "string" ? flagToken : process.env.TODOX_TOKEN ?? "",
    transport,
    dryRun: Boolean(flags["dry-run"]),
    verbose: Boolean(flags.verbose),
  };
}
