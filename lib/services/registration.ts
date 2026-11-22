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
