import { appendEvent } from "./state";
import type { HookContext, HookOutput } from "./types";

/**
 * The developer's way out for one session, said in the prompt where they
 * already are: "no-handoff" or "todox off" anywhere in a message, and the
 * Stop hook leaves this session alone. A setting would be a second place to
 * look; an environment variable (`TODOX_STOP=off`) is there for always.
 */
const OPT_OUT = /\b(no-handoff|todox off)\b/i;

export async function userPromptSubmit(ctx: HookContext): Promise<HookOutput> {
  const { session_id: sessionId, prompt } = ctx.input;
  if (!sessionId || typeof prompt !== "string" || !OPT_OUT.test(prompt)) return null;
  appendEvent(ctx.config.dataDir, sessionId, { t: "optout", at: ctx.now().toISOString() });
  return null;
}
