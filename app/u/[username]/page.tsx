import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import type { ContextKind } from "@/lib/constants";
import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { clientIp } from "@/lib/server/client-ip";
import { publicProfile, PROFILE_DAYS, type PublicProfile } from "@/lib/services/profile";
import * as limit from "@/lib/services/rate-limit";
import { DEFAULT_TZ } from "@/lib/util/time";
import { BrainMap, Heatmap, Panel, ShareBars, StatBadges } from "../../components";
import { CONTEXT_KIND_COLOR, contextKindLabel } from "../../kinds";
import { pageOpenGraph } from "../../metadata-shared";

export const dynamic = "force-dynamic";

/** Metadata and the render both need it; one read per view, not two. */
const profileFor = cache(publicProfile);

/**
 * Unlisted whether or not it resolves, like a share link: the noindex is set
 * before the lookup, so a profile somebody turns off is not left in a search
 * engine, and a wrong username answers exactly like an unpublished one.
 */
export async function generateMetadata({
  params,
}: PageProps<"/u/[username]">): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { username } = await params;
  const profile = await profileFor(username);
  if (!profile) return { robots };
  const title = `${profile.user.name} (@${profile.user.username})`;
  const description = profile.user.bio ?? undefined;
  return {
    title,
    description,
    robots,
    openGraph: { ...pageOpenGraph(`/u/${profile.user.username}`), title, description },
  };
}

/**
 * A developer's public page: a year of activity, the projects and notes they
 * chose to show, and nothing they did not. What it may read is decided in
 * `publicProfile`; this file only draws it.
 */
export default async function ProfilePage({ params }: PageProps<"/u/[username]">) {
  const { username } = await params;
  const { t, lang } = await getT();

  // Before the reads, which are the expensive part: this answers without a
  // session, exactly like a share link.
  const gate = await limit.consume("profilePerIp", clientIp(await headers()));
  if (!gate.allowed) {
    return (
      <div className="sticker pop space-y-2 p-5">
        <h1 className="display text-[20px] font-bold">{t("sharedBusyTitle")}</h1>
        <p className="text-[14.5px] leading-relaxed text-muted">
          {t("sharedBusyBody", { n: Math.ceil(gate.retryAfterSec / 60) })}
        </p>
      </div>
    );
  }

  const profile = await profileFor(username);
  if (!profile) notFound();
  const { user, totals } = profile;
  const since = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(
    new Date(user.created_at),
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date());

  return (
    <div className="space-y-6">
      <header className="pop flex flex-wrap items-center gap-4">
        <span
          aria-hidden="true"
          className="display grid size-16 shrink-0 place-items-center rounded-full border-2 border-accent bg-card text-[28px] text-ink-head"
        >
          {(user.name || user.username).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-[12rem] flex-1">
          <h1 className="display text-[clamp(26px,4vw,36px)] leading-[1.1]">{user.name}</h1>
          <p className="mono text-small text-faint">
            @{user.username} · {t("profSince", { d: since })}
          </p>
        </div>
      </header>
      {user.bio && (
        <p className="pop max-w-[70ch] text-[15.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">
          {user.bio}
        </p>
      )}

      <StatBadges
        label={t("profActivity")}
        className="pop"
        stats={[
          { label: t("profEntries"), value: totals.entries, mark: "var(--accent)" },
          { label: t("profActiveDays"), value: totals.activeDays, mark: "var(--k-note)" },
          { label: t("profDone"), value: totals.done, mark: "var(--ok)" },
          { label: t("profDecisions"), value: totals.decisions, mark: "var(--k-decision)" },
          { label: t("profDeadEnds"), value: totals.deadEnds, mark: "var(--k-dead_end)" },
        ]}
      />

      <Panel title={t("profActivity")} delay={40}>
        <div className="space-y-3 p-4">
          <p className="text-small text-muted">{activitySentence(profile, t)}</p>
          <Heatmap days={profile.days} today={today} less={t("profLess")} more={t("profMore")} />
        </div>
      </Panel>

      {profile.projects.length > 0 && (
        <Panel title={t("profProjects")} delay={80}>
          <div className="space-y-4 p-4">
            {profile.projects.length >= 3 && (
              <BrainMap nodes={profile.projects} centre={user.username.slice(0, 8)} />
            )}
            <ul className="grid gap-3 sm:grid-cols-2">
              {profile.projects.map((p) => (
                <li key={p.slug} className="sticker-flat flex min-w-0 flex-col gap-1.5 p-3">
                  <span className="display truncate text-[16px] text-ink-head">{p.name}</span>
                  {p.summary && (
                    <p className="line-clamp-3 text-small break-words text-muted">{p.summary}</p>
                  )}
                  <span className="mono text-meta text-faint">
                    {t("profProjectRow", { done: p.done, open: p.open, entries: p.activity })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      )}

      {profile.notes.length > 0 && (
        <Panel title={t("profNotes")} delay={120}>
          <ul className="space-y-3 p-4">
            {profile.notes.map((n) => (
              <PublicNoteRow key={n.id} kind={n.kind} title={n.title} body={n.body} t={t} />
            ))}
          </ul>
        </Panel>
      )}

      {profile.models.length > 0 && (
        <Panel title={t("byModel")} delay={160}>
          <div className="p-4">
            <ShareBars
              color="var(--k-decision)"
              rows={profile.models.map((m) => ({
                key: m.model,
                label: <code className="mono text-[13px] break-all">{m.model}</code>,
                value: m.entries,
                text: `${m.entries} ${t("totalsEntries")}`,
              }))}
            />
          </div>
        </Panel>
      )}

      <p className="pop text-center text-meta text-faint">
        <Link href="/" className="hover:underline">
          {t("profFooter")}
        </Link>
      </p>
    </div>
  );
}

function activitySentence(profile: PublicProfile, t: T): string {
  if (!profile.totals.entries) return t("profNoActivity", { n: PROFILE_DAYS });
  const busiest = profile.days.reduce((a, b) => (b.n > a.n ? b : a));
  return t("profActivitySub", {
    n: profile.totals.entries,
    d: profile.totals.activeDays,
    day: busiest.day,
    max: busiest.n,
  });
}

function PublicNoteRow({ kind, title, body, t }: { kind: ContextKind; title: string; body: string; t: T }) {
  return (
    <li className="sticker-flat flex flex-col gap-1 p-3">
      <span className="flex items-center gap-2 text-meta text-muted">
        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: CONTEXT_KIND_COLOR[kind] }} />
        {contextKindLabel(t, kind)}
      </span>
      <span className="text-[15px] font-semibold break-words text-ink-head">{title}</span>
      <p className="text-small leading-relaxed break-words whitespace-pre-wrap text-muted">{body}</p>
    </li>
  );
}
