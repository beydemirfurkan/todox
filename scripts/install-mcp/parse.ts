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
  /**
   * Also write the four-line habit into the client's user-level memory file.
   *
   * Off by default, and asked for by name. Registering a server in a config
   * file todox owns the entry in is one thing; adding lines to the file someone
   * keeps their own standing instructions in is another, and doing the second
   * because they asked for the first is the kind of surprise that gets a tool
   * uninstalled. `--dry-run` prints what it would write.
   */
  writeMemory: boolean;
  /**
   * OpenCode only. Undefined means "work it out from the existing config",
   * which is what almost every run does; the flag is for the case where there
   * is no config to read yet and the user knows which major they run.
   */
  openCodeLayout?: "v1" | "v2";
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
const BOOLEAN_FLAGS = new Set(["dry-run", "verbose", "write-memory"]);

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

  // Same reasoning as --transport: a value we do not recognise has to fail
  // here, because the installer would otherwise fall back to detection and the
  // user would never learn their flag was ignored.
  const layoutFlag = flags["opencode-layout"];
  if (layoutFlag !== undefined && layoutFlag !== "v1" && layoutFlag !== "v2") {
    throw new Error(`--opencode-layout must be 'v1' or 'v2' (got '${String(layoutFlag)}')`);
  }

  return {
    openCodeLayout: layoutFlag,
    client: clientName,
    url: typeof flags.url === "string" ? flags.url : "https://www.todox.dev/api/mcp",
    token: typeof flagToken === "string" ? flagToken : process.env.TODOX_TOKEN ?? "",
    transport,
    dryRun: Boolean(flags["dry-run"]),
    verbose: Boolean(flags.verbose),
    writeMemory: Boolean(flags["write-memory"]),
  };
}
