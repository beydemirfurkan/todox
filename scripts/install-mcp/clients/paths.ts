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

/** `%APPDATA%\Code\User\` on Windows, `~/.config/Code/User/` elsewhere. */
export function vsCodeConfigDir(): string {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "Code", "User");
  }
  return path.join(os.homedir(), ".config", "Code", "User");
}
