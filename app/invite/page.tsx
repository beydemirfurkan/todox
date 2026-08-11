import type { Metadata } from "next";
import Link from "next/link";

import { getT } from "@/lib/lang";
import * as invitations from "@/lib/repositories/project-invitations";
import { currentUser } from "@/lib/session";
import { acceptNewAccountInviteAction, acceptProjectInviteAction } from "../actions";
import { AuthShell } from "../features/auth-shell";
import { SubmitButton } from "../features/submit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer" };

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { t } = await getT();
  const token = first((await searchParams).token);
  const invitation = token ? await invitations.byToken(token, new Date().toISOString()) : null;
  if (!invitation)
    return (
      <AuthShell mood="worried" fill="var(--k-dead_end)" title={t("inviteInvalidTitle")}>
        <p className="text-[15px] text-muted">{t("inviteInvalidBody")}</p>
        <Link href="/account?tab=invites" className="btn mt-4 block text-center">
          {t("viewInvites")}
        </Link>
      </AuthShell>
    );

  const user = await currentUser();
  const next = `/invite?token=${token}`;
  if (!user)
    return (
      <AuthShell
        mood="idle"
        title={t("inviteTitle")}
        intro={t("inviteDescription", { project: invitation.project_name })}
      >
        <form action={acceptNewAccountInviteAction}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="btn w-full" pendingLabel={t("working")}>
            {t("acceptInvite")}
          </SubmitButton>
        </form>
        <p className="mt-3 text-center text-[12.5px] text-muted">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="link-more">
            {t("haveAccount")}
          </Link>
        </p>
      </AuthShell>
    );

  const matches = user.email.toLowerCase() === invitation.email.toLowerCase();
  return (
    <AuthShell
      mood={matches ? "happy" : "worried"}
      title={t("inviteTitle")}
      intro={t("inviteDescription", { project: invitation.project_name })}
    >
      {matches ? (
        <form action={acceptProjectInviteAction}>
          {/* The token, not the id: holding it is what proves this inbox is
              yours, and it is the only thing that lets an address which has
              never been verified accept an invitation at all. */}
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="btn w-full" pendingLabel={t("working")}>
            {t("acceptInvite")}
          </SubmitButton>
        </form>
      ) : (
        <p className="text-[14px] text-muted">{t("inviteEmailMismatch")}</p>
      )}
    </AuthShell>
  );
}
