import { tx } from "../db/client";
import type { Lang } from "../i18n";
import { logError } from "../server/log";
import { publicUrl } from "../public-url";
import * as invitations from "../repositories/project-invitations";
import * as memberships from "../repositories/project-memberships";
import * as notifications from "../repositories/notifications";
import * as projects from "../repositories/projects";
import * as users from "../repositories/users";
import * as templates from "./mail-templates";
import { send } from "./mailer";
import { ownsProject } from "./ownership";
import * as limit from "./rate-limit";
import { newSessionToken } from "../util/tokens";
import { hashPassword } from "../util/password";
import { now } from "../util/time";

const INVITE_DAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteResult = "sent" | "invalid" | "exists" | "limited" | "not-owner";

export async function invite(input: {
  userId: number;
  projectId: number;
  email: string;
  lang: Lang;
}): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return "invalid";
  if (!(await ownsProject(input.userId, input.projectId))) return "not-owner";
  const inviter = await users.byId(input.userId);
  if (!inviter || inviter.email.toLowerCase() === email) return "exists";
  if (await memberships.byProjectAndEmail(input.projectId, email)) return "exists";

  const [userGate, recipientGate] = await Promise.all([
    limit.consume("invitePerUser", String(input.userId)),
    limit.consume("invitePerRecipient", email),
  ]);
  if (!userGate.allowed || !recipientGate.allowed) return "limited";

  const project = await projects.ownedById(input.userId, input.projectId);
  if (!project) return "not-owner";
  const token = newSessionToken();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  await invitations.replacePending({
    projectId: project.id,
    email,
    invitedBy: input.userId,
    token,
    createdAt,
    expiresAt,
  });

  // Somebody who already has an account gets the bell as well as the mail.
  // Somebody who does not has only the mail, which is what the link is for.
  const recipient = await users.byEmail(email);
  if (recipient)
    await notifications.create({
      userId: recipient.id,
      kind: "invite_received",
      projectId: project.id,
      actorId: input.userId,
    });

  const link = `${publicUrl()}/invite?token=${encodeURIComponent(token)}`;
  await send({
    to: email,
    ...templates.projectInvitation({
      projectName: project.name,
      link,
      days: INVITE_DAYS,
      lang: input.lang,
    }),
  });
  return "sent";
}

export function nextMembershipSlug(userId: number, base: string) {
  return projects.nextFreeSlug(userId, base);
}

/**
 * Joins a project, once the caller has been shown to hold the address it was
 * offered to.
 *
 * There are only two ways to show that, and both are here:
 *
 * - `token`, which arrived in the invitation email. Holding it *is* the proof,
 *   so this route works for an address that has never been verified — and, as
 *   the one thing that does prove the inbox, it is also what may mark the
 *   address verified.
 * - a verified address plus the invitation's id, for the list on the account
 *   page, where the token is not to hand. The verification already happened,
 *   through a link sent to the same inbox.
 *
 * The id on its own proves nothing, and it used to be enough. An account may
 * claim any address and keep working unverified, the account page listed every
 * pending invitation for the address it claimed, and accepting one both granted
 * write access to somebody else's project and marked the claimed address
 * verified — which is the gate on publishing a public share link. Sequential
 * ids meant it was not even necessary to see the list.
 */
export async function accept(input: {
  userId: number;
  email: string;
  invitationId?: number;
  token?: string;
  /** Only consulted on the id route; a token speaks for itself. */
  emailVerified?: boolean;
  /**
   * The accepting person's language, used for the owner's mail.
   *
   * The wrong person's, strictly: nobody's preferred language is stored. It is
   * the same borrow `invite` already makes in the other direction, where the
   * inviter's language decides what the invitee reads. One inconsistency, in
   * two places, rather than a new one.
   */
  lang: Lang;
}) {
  const acceptedAt = now();

  const invitation = input.token
    ? await invitations.byToken(input.token, acceptedAt)
    : input.emailVerified && input.invitationId
      ? await invitations.byIdForEmail(input.invitationId, input.email, acceptedAt)
      : null;

  // A token is bound to one address, and the person holding it has to be the
  // one it was sent to. Otherwise a forwarded link would be a way in.
  if (!invitation) return null;
  if (invitation.email.toLowerCase() !== input.email.toLowerCase()) return null;

  const accessSlug = await nextMembershipSlug(input.userId, invitation.project_slug);
  const [accepted, member] = await tx([
    invitations.acceptStmt(invitation.id, input.userId, acceptedAt),
    memberships.createForAcceptedInvitationStmt({
      invitationId: invitation.id,
      userId: input.userId,
      accessSlug,
      acceptedAt,
    }),
    // Reaching the link proves the inbox, which is the same thing the
    // verification mail asks for. Accepting from the account list does not, and
    // does not need to: that address is already verified.
    ...(input.token ? [users.markEmailVerifiedStmt(input.userId)] : []),
    // Last, so it can look at what the statements above just wrote. Guarded
    // the same way the membership insert is: a replayed invitation must not
    // hand the owner a second "they accepted".
    ...(invitation.owner_id
      ? [
          notifications.createForAcceptedInvitationStmt({
            userId: invitation.owner_id,
            kind: "invite_accepted",
            projectId: invitation.project_id,
            actorId: input.userId,
            invitationId: invitation.id,
            acceptedBy: input.userId,
            acceptedAt,
          }),
        ]
      : []),
  ]);
  if (!accepted.length) return null;
  await announce(invitation.owner_id, invitation.project_name, input.userId, input.lang);
  // Existing members can encounter a retried invitation; their usable route is
  // already present even if ON CONFLICT returned no newly inserted row.
  const row = member[0] as { access_slug: string } | undefined;
  if (row) return row.access_slug;
  const existing = (await memberships.listByUser(input.userId)).find(
    (m) => m.project_id === invitation.project_id,
  );
  return existing?.access_slug ?? null;
}

export async function acceptWithNewAccount(token: string, lang: Lang) {
  const acceptedAt = now();
  const invitation = await invitations.byToken(token, acceptedAt);
  if (!invitation || (await users.byEmail(invitation.email))) return null;
  const accessSlug = await nextMembershipSlug(0, invitation.project_slug);
  // The account starts passwordless from the person's point of view. The
  // random credential is never exposed; they can set one through email reset.
  const randomCredential = newSessionToken();
  const username = `invited-${newSessionToken().slice(0, 12).toLowerCase()}`;
  const result = await invitations.acceptWithNewUser({
    token,
    username,
    passwordHash: await hashPassword(randomCredential),
    accessSlug,
    acceptedAt,
  });
  if (!result) return null;

  // Written after the fact rather than inside that CTE, which already carries
  // three dependent writes. A dropped notification is not the class of loss
  // the transaction rule exists for: nothing later is computed from it.
  if (invitation.owner_id) {
    await notifications.create({
      userId: invitation.owner_id,
      kind: "invite_accepted",
      projectId: invitation.project_id,
      actorId: result.user_id,
    });
    await announce(invitation.owner_id, invitation.project_name, result.user_id, lang);
  }
  return result;
}

/**
 * Tells the owner, by mail, that somebody took up their invitation.
 *
 * Bodies are inline rather than in the dictionaries: that is where every mail
 * in this codebase lives, and it is written down in CONTRIBUTING as the one
 * known exception. Failures are swallowed -- the membership is already real,
 * and an SMTP outage must not turn a successful join into an error page.
 */
async function announce(
  ownerId: number | null,
  projectName: string,
  actorId: number,
  lang: Lang,
) {
  if (!ownerId) return;
  const [owner, actor] = await Promise.all([users.byId(ownerId), users.byId(actorId)]);
  if (!owner) return;
  const who = actor?.name?.trim() || actor?.email || "";

  try {
    await send({
      to: owner.email,
      ...templates.invitationAccepted({ who, projectName, url: publicUrl(), lang }),
    });
  } catch (error) {
    // Nothing to recover -- the join happened either way, and failing the
    // request over a notification would undo work that succeeded. But an empty
    // catch means the owner is simply never told and nobody ever finds out why,
    // and `send` swallows its own failures, so reaching here at all is already
    // something unexpected.
    logError("invitation.accepted.notify_failed", error);
  }
}
