import type { OpenCodeMajor } from "./contract";

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
    /**
     * OpenCode only: write this config layout instead of detecting one. Named
     * for the client it belongs to rather than hidden behind a generic
     * `options` bag — a reader of this type should be able to see that exactly
     * one installer takes an override, and which.
     */
    openCodeLayout?: OpenCodeMajor;
  }): Promise<{
    path: string;
    status: "created" | "updated";
    entryId: string;
    /** Anything the CLI should print that only this installer knows. */
    note?: string;
  }>;
  /**
   * Read back what `install` wrote. Returns ok=false when the config is
   * missing the entry — the CLI turns that into "install failed" rather than
   * "install succeeded but verify failed".
   */
  verify(): Promise<{ ok: boolean; detail: string }>;
  /**
   * todox entries sitting where this client does not read them — a leftover
   * from a todox version that wrote the wrong path or the wrong root key.
   * Descriptions, not paths to delete: the CLI prints them so the user can
   * remove them, because a config file is theirs to edit and a CLI that
   * quietly deletes one is a worse surprise than the stale entry.
   *
   * Runs in `--dry-run` too, which is the cheapest way for someone to find out
   * their existing install has been dead the whole time.
   */
  staleInstalls(): Promise<string[]>;
};
