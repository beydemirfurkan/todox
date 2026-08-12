import * as os from "node:os";
import * as path from "node:path";

/**
 * `~` on Windows is `%USERPROFILE%`, on POSIX it's `$HOME`. The MCP client
 * config files store `~` literally (every client we tested expanded it
 * itself), so we expand here so the file we write is unambiguous.
 */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\"))
    return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * VS Code's per-user config directory:
 * `%APPDATA%\Code\User\` on Windows, `~/Library/Application Support/Code/User/`
 * on macOS, `~/.config/Code/User/` on Linux.
 *
 * macOS is not the Linux path. VS Code is an Electron app and follows Apple's
 * convention there, so the XDG-style fallback that covers Linux is wrong for
 * darwin -- and wrong in the worst way, because `~/.config/Code/User` does not
 * exist on a Mac, so writing to it succeeds, creates the tree, and reads back
 * exactly what was written. That is how this shipped green: the installer
 * confirmed its own output instead of the location VS Code reads.
 */
export function vsCodeConfigDir(): string {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "Code", "User");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User");
  }
  return path.join(os.homedir(), ".config", "Code", "User");
}

/**
 * Directories a previous todox wrote a VS Code config into that this platform's
 * VS Code never reads. Only darwin has one, because only darwin was wrong.
 *
 * The install is not finished when the right file exists -- a Mac that ran the
 * broken version still has a config in `~/.config/Code/User`, and leaving it
 * there leaves the user with two files and no way to tell which one is live.
 */
export function vsCodeStaleConfigDirs(): readonly string[] {
  if (process.platform !== "darwin") return [];
  return [path.join(os.homedir(), ".config", "Code", "User")];
}
