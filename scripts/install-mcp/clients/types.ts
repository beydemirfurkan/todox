/**
 * One client, one install strategy. The CLI dispatches on `name` to the
 * matching installer; each file owns its own config-file format and quirks.
 *
 * `install` is idempotent: a second call against an already-configured client
 * must not duplicate the entry — replace by `name`, leave other entries alone.
 */
export type ClientInstaller = {
  /** Canonical name, used in argv (`todox install-mcp <name>`) and in tests. */
  readonly name: string;
  /** Does the user's machine appear to host this client? Cheap filesystem check. */
  detect(): Promise<boolean>;
  /**
   * Write or update the config. Returns the path touched and whether the entry
   * was newly created or replaced. Must throw on permission errors so the CLI
   * can show the user something actionable.
   */
  install(input: {
    transport: "http" | "stdio";
    url: string;
    token: string;
  }): Promise<{ path: string; status: "created" | "updated"; entryId: string }>;
  /**
   * Read back what `install` wrote. Returns ok=false when the config is
   * missing the entry — the CLI turns that into "install failed" rather than
   * "install succeeded but verify failed".
   */
  verify(): Promise<{ ok: boolean; detail: string }>;
};
