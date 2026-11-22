import { observeSession } from "./observe";
import type { HookContext, HookOutput } from "./types";

/**
 * The last look at the tree before the session is gone. Claude Code shows
 * nothing a SessionEnd hook prints, so this only records; a state the Stop
 * hook already sent is not sent again.
 */
export async function sessionEnd(ctx: HookContext): Promise<HookOutput> {
  await observeSession(ctx);
  return null;
}
