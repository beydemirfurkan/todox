import { tx } from "../db/client";
import type { Lang } from "../i18n";
import { publicUrl } from "../public-url";
import * as invitations from "../repositories/project-invitations";
import * as memberships from "../repositories/project-memberships";
import * as projects from "../repositories/projects";
import * as users from "../repositories/users";
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

  const link = `${publicUrl()}/invite?token=${encodeURIComponent(token)}`;
  await send({
    to: email,
    subject:
      input.lang === "tr"
        ? `${project.name} projesine davet edildiniz`
        : `You were invited to ${project.name}`,
    text:
      input.lang === "tr"
        ? `${project.name} projesinde birlikte çalışmak için davet edildiniz.\n\nDaveti görüntüleyin ve kabul edin:\n${link}\n\nBu bağlantı ${INVITE_DAYS} gün geçerlidir.`
        : `You were invited to collaborate on ${project.name}.\n\nReview and accept the invitation:\n${link}\n\nThis link expires in ${INVITE_DAYS} days.`,
  });
  return "sent";
}

export function nextMembershipSlug(userId: number, base: string) {
  return projects.nextFreeSlug(userId, base);
}

export async function accept(input: { userId: number; email: string; invitationId: number }) {
  const acceptedAt = now();
  const invitation = await invitations.byIdForEmail(input.invitationId, input.email, acceptedAt);
  if (!invitation) return null;
  const accessSlug = await nextMembershipSlug(input.userId, invitation.project_slug);
  const [accepted, member] = await tx([
    invitations.acceptStmt(invitation.id, input.userId, acceptedAt),
    memberships.createForAcceptedInvitationStmt({
      invitationId: invitation.id,
      userId: input.userId,
      accessSlug,
      acceptedAt,
    }),
    users.markEmailVerifiedStmt(input.userId),
  ]);
  if (!accepted.length) return null;
  // Existing members can encounter a retried invitation; their usable route is
  // already present even if ON CONFLICT returned no newly inserted row.
  const row = member[0] as { access_slug: string } | undefined;
  if (row) return row.access_slug;
  const existing = (await memberships.listByUser(input.userId)).find(
    (m) => m.project_id === invitation.project_id,
  );
  return existing?.access_slug ?? null;
}

export async function acceptWithNewAccount(token: string) {
  const acceptedAt = now();
  const invitation = await invitations.byToken(token, acceptedAt);
  if (!invitation || (await users.byEmail(invitation.email))) return null;
  const accessSlug = await nextMembershipSlug(0, invitation.project_slug);
  // The account starts passwordless from the person's point of view. The
  // random credential is never exposed; they can set one through email reset.
  const randomCredential = newSessionToken();
  const username = `invited-${newSessionToken().slice(0, 12).toLowerCase()}`;
  return invitations.acceptWithNewUser({
    token,
    username,
    passwordHash: await hashPassword(randomCredential),
    accessSlug,
    acceptedAt,
  });
}
