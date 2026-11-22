import { logWarn } from "./server/log";

/**
 * Where this instance is reachable from outside.
 *
 * Verification links, reset links and the agent setup snippets are all built
 * from it, so getting it wrong sends people — and their agents — to the wrong
 * host. It lives on its own rather than in `mailer.ts` because the account page
 * needs it to render the MCP URL, and importing the mailer for that would drag
 * an SMTP client into a page that sends nothing.
 */
const FALLBACK = "http://localhost:3000";

let isUnsetWarned = false;

export function publicUrl() {
  const configured = process.env.TODOX_PUBLIC_URL?.trim();
  if (!configured) warnUnsetInProduction();
  // Trailing slashes are stripped because callers append a path. A value ending
  // in `/` would produce `//api/mcp`, which does not route — and that URL is
  // what every generated agent snippet carries, so the failure would surface as
  // a 404 inside somebody's editor with nothing pointing back here.
  return (configured || FALLBACK).replace(/\/+$/, "");
}

/**
 * Unset in production, every snippet and mail link points at localhost and
 * looks like it worked. Compose refuses to start without it; a bare
 * `pnpm start` does not, so say it once.
 */
function warnUnsetInProduction(): void {
  if (process.env.NODE_ENV !== "production" || isUnsetWarned) return;
  isUnsetWarned = true;
  logWarn("publicUrl.notConfigured", {
    detail: `TODOX_PUBLIC_URL is not set; links and agent snippets point at ${FALLBACK}`,
  });
}
