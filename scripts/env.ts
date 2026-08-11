import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Next loads .env.local by itself; plain scripts do not. Rather than add a
 * dependency for six lines, read the file when a variable is missing.
 *
 * Real environment variables always win, so CI and production are unaffected.
 */
export function loadEnv(file = ".env.local") {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

loadEnv();
loadEnv(".env");
