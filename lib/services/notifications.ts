import type { NotificationKind } from "../constants";
import type { T } from "../i18n";
import * as notifications from "../repositories/notifications";
import type { NotificationView } from "../types";
import { now } from "../util/time";

/** What the bell holds. Beyond this the account page is the honest answer. */
const SHOWN = 8;

export type Feed = { items: NotificationView[]; unread: number };

export async function feed(userId: number): Promise<Feed> {
  const rows = await notifications.feed(userId, SHOWN);
  // The window count comes back on every row and is the same on all of them;
  // with no rows there is nothing unread either.
  const unread = rows.length ? Number(rows[0].unread) : 0;
  return { items: rows.map(({ unread: _ignored, ...row }) => row), unread };
}

export const markAllRead = (userId: number) => notifications.markAllRead(userId, now());

/**
 * The sentence a notification reads as.
 *
 * Kept out of the component so it can be tested against both dictionaries:
 * the type system guarantees a key exists, not that this switch reaches it,
 * so a new kind whose translation nobody wrote fails a test rather than
 * printing a blank line in somebody's header.
 *
 * Every branch tolerates a missing name. `actor_id` is ON DELETE SET NULL, so
 * "somebody" is a real state and not a defensive flourish.
 */
export function notificationText(n: NotificationView, t: T): string {
  const who = n.actor_name ?? t("someone");
  const project = n.project_name ?? t("aProject");

  const kind: NotificationKind = n.kind;
  switch (kind) {
    case "invite_received":
      return t("notifInviteReceived", { who, project });
    case "invite_accepted":
      return t("notifInviteAccepted", { who, project });
    case "member_removed":
      return t("notifMemberRemoved", { project });
  }
}

/**
 * Where a notification takes you, or nowhere.
 *
 * `project_slug` is the recipient's own route and comes back null when they
 * cannot reach the project: a pending invitation, or a membership that has
 * just been removed. The first has somewhere better to go; the second has
 * nowhere at all, and a link to a 404 is worse than plain text.
 */
export function notificationHref(n: NotificationView): string | null {
  if (n.kind === "invite_received") return "/account?tab=invites";
  return n.project_slug ? `/p/${n.project_slug}` : null;
}
