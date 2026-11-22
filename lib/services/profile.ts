import * as contexts from "../repositories/contexts";
import * as entries from "../repositories/entries";
import * as projects from "../repositories/projects";
import * as tasks from "../repositories/tasks";
import * as users from "../repositories/users";
import { DEFAULT_TZ } from "../util/time";
import { BRAIN_MAP_DAYS } from "./brain-map";

/** How far back the profile's activity reaches. */
export const PROFILE_DAYS = 365;
const PROFILE_PROJECTS = 24;
const PROFILE_NOTES = 30;
const PROFILE_MODELS = 5;

export interface ProfileDay {
  day: string;
  n: number;
}

export interface ProfileProjectCard {
  slug: string;
  name: string;
  summary: string | null;
  done: number;
  open: number;
  /** Entries in the last `BRAIN_MAP_DAYS`, by kind: what the map draws. */
  activity: number;
  decisions: number;
  deadEnds: number;
  questions: number;
}

export interface PublicProfile {
  user: users.PublicUser;
  days: ProfileDay[];
  totals: { entries: number; decisions: number; deadEnds: number; done: number; activeDays: number };
  models: { model: string; entries: number }[];
  projects: ProfileProjectCard[];
  notes: contexts.PublicNote[];
}

/**
 * Everything /u/<username> shows, or null for every reason it shows nothing.
 *
 * What it reads is the whole privacy promise of the page, so it is all here:
 * counts of the owner's own entries, the projects they marked, and the notes
 * they marked -- never a task title, a log line, a path, an email, or
 * `tool_usage`, which is a measurement and not a record. Two rounds: the user,
 * then six grouped reads at once.
 */
export async function publicProfile(username: string): Promise<PublicProfile | null> {
  const user = await users.findPublicProfile(username);
  if (!user) return null;

  const yearAgo = new Date(Date.now() - PROFILE_DAYS * 86_400_000).toISOString();
  const lately = new Date(Date.now() - BRAIN_MAP_DAYS * 86_400_000).toISOString();
  const [daily, done, models, marked, counts, kinds, notes] = await Promise.all([
    entries.dailyKindsByAuthor(user.id, yearAgo, DEFAULT_TZ),
    tasks.countDoneSince(user.id, yearAgo),
    entries.modelsSince(user.id, yearAgo, PROFILE_MODELS),
    projects.listOnProfile(user.id, PROFILE_PROJECTS),
    tasks.countsByProject(user.id),
    entries.kindCountsByProjectSince(user.id, lately),
    contexts.publicNotes(user.id, PROFILE_NOTES),
  ]);

  return {
    user,
    days: sumByDay(daily),
    totals: totalsOf(daily, done),
    models,
    projects: marked.map((p) => projectCard(p, counts, kinds)),
    notes,
  };
}

function sumByDay(daily: { day: string; n: number }[]): ProfileDay[] {
  const byDay = new Map<string, number>();
  for (const d of daily) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.n);
  return [...byDay].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day));
}

function totalsOf(daily: { day: string; kind: string; n: number }[], done: number) {
  const sum = (kind: string) => daily.filter((d) => d.kind === kind).reduce((n, d) => n + d.n, 0);
  return {
    entries: daily.reduce((n, d) => n + d.n, 0),
    decisions: sum("decision"),
    deadEnds: sum("dead_end"),
    done,
    activeDays: new Set(daily.map((d) => d.day)).size,
  };
}

function projectCard(
  p: projects.ProfileProject,
  counts: Awaited<ReturnType<typeof tasks.countsByProject>>,
  kinds: { project_id: number; kind: string; n: number }[],
): ProfileProjectCard {
  const c = counts.map.get(p.id) ?? counts.empty;
  const mine = kinds.filter((k) => k.project_id === p.id);
  const of = (kind: string) => mine.find((k) => k.kind === kind)?.n ?? 0;
  return {
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    done: c.done,
    open: c.todo + c.doing + c.blocked,
    activity: mine.reduce((n, k) => n + k.n, 0),
    decisions: of("decision"),
    deadEnds: of("dead_end"),
    questions: of("question"),
  };
}
