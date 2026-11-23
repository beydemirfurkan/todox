import * as invitations from "../repositories/project-invitations";
import { now } from "../util/time";

/**
 * Whether this instance takes new accounts from anyone who finds it.
 *
 * Open unless `TODOX_REGISTRATION=closed`. A self-hosted instance on a public
 * address otherwise accepts every signup, with no admin to notice. Closed, the
 * only way in is an invitation to a project, which somebody already inside
 * chose to send.
 */
export function isRegistrationOpen(): boolean {
  return process.env.TODOX_REGISTRATION?.trim().toLowerCase() !== "closed";
}

/**
 * Whether a new account for `email` may be created. On a closed instance that
 * takes a live invitation sent to that very address: holding the token proves
 * the link arrived, and the address match keeps one invitation from opening
 * the door for somebody else's account.
 */
export async function canRegister(email: string, inviteToken?: string): Promise<boolean> {
  if (isRegistrationOpen()) return true;
  if (!inviteToken) return false;
  const invitation = await invitations.byToken(inviteToken, now());
  return invitation?.email.toLowerCase() === email.trim().toLowerCase();
}
