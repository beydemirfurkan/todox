"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ContextKind, EntryKind, Status } from "@/lib/constants";
import { isLang } from "@/lib/i18n";
import { LANG_COOKIE } from "@/lib/lang";
import * as contexts from "@/lib/repositories/contexts";
import * as entries from "@/lib/repositories/entries";
import * as projects from "@/lib/repositories/projects";
import * as invitations from "@/lib/repositories/project-invitations";
import * as collaboration from "@/lib/services/collaboration";
import * as notificationService from "@/lib/services/notifications";
import * as refs from "@/lib/repositories/refs";
import {
  assertContext,
  assertEntry,
  assertProject,
  assertRef,
  assertTask,
} from "@/lib/services/ownership";
import * as sharing from "@/lib/services/sharing";
import * as taskService from "@/lib/services/task-service";
import { accept, acceptWithNewAccount, invite } from "@/lib/services/project-invitations";
import { getLang } from "@/lib/lang";
import * as auth from "@/lib/services/auth";
import { setSessionCookie } from "@/lib/session";
import { requireUser } from "@/lib/session";
import type { AuthState } from "./auth-actions";

const str = (fd: FormData, k: string) => (fd.get(k) as string | null)?.trim() || "";
const num = (fd: FormData, k: string) => Number(fd.get(k));

/* -------------------------------------------------------------- language */

/** The only action that does not need an account: it just sets a cookie. */
export async function setLangAction(fd: FormData) {
  const lang = fd.get("lang");
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // Only the server reads this; matching the session cookie's flags costs
    // nothing. `secure` stays conditional -- unconditional, it would stop the
    // cookie being stored over plain http and break language switching in dev.
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}

/* --------------------------------------------------------- notifications */

/**
 * Called when the bell is opened, not submitted from a form.
 *
 * No `revalidatePath`: the panel has already dropped its own badge, and
 * re-rendering the layout underneath an open menu would close it.
 */
export async function markNotificationsReadAction() {
  const user = await requireUser();
  await notificationService.markAllRead(user.id);
}

/* --------------------------------------------------------------- sharing */

export async function setSharingAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "project_id");
  await assertProject(user.id, id);
  // Publishing is the one outward-facing action, so it is the one gated on a
  // verified address. Turning sharing off is always allowed.
  const enabling = fd.get("enabled") === "1";
  if (enabling && !user.email_verified_at) return;
  await sharing.setSharing(user.id, id, {
    enabled: fd.get("enabled") === "1",
    includeLog: fd.get("include_log") === "on",
  });
  revalidatePath("/", "layout");
}

export async function rotateShareAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "project_id");
  await assertProject(user.id, id);
  await sharing.rotate(user.id, id);
  revalidatePath("/", "layout");
}

/* -------------------------------------------------------------- projects */

export async function createProjectAction(fd: FormData) {
  const user = await requireUser();
  const name = str(fd, "name");
  if (!name) return;
  const p = await projects.create(user.id, {
    name,
    slug: await projects.nextFreeSlug(user.id, str(fd, "name")),
    root_path: str(fd, "root_path") || null,
    summary: str(fd, "summary") || null,
  });
  redirect(`/p/${p.slug}`);
}

export async function updateProjectAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "id");
  await assertProject(user.id, id);
  await projects.update(user.id, id, {
    name: str(fd, "name") || undefined,
    root_path: str(fd, "root_path") || null,
    summary: str(fd, "summary") || null,
  });
  revalidatePath("/", "layout");
}

/**
 * Gated on typing the slug, and on nothing else being ambiguous about it.
 *
 * Registering a project is deliberately free -- any absolute path an agent
 * hands over becomes one -- so there has to be a way back. There was not, and
 * a project created by a mistyped `cwd` stayed in the account for good.
 * Everything below it goes: the schema cascades from this row.
 */
export async function deleteProjectAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const user = await requireUser();
  const id = num(fd, "project_id");
  await assertProject(user.id, id);

  const project = await projects.byId(user.id, id);
  if (!project) redirect("/");
  // Said out loud rather than returned silently: a form that posts, comes
  // back unchanged and explains nothing is the worst of both answers.
  if (str(fd, "confirm").toLowerCase() !== project.slug.toLowerCase())
    return { errors: [{ field: "confirm", code: "confirmMismatch" }] };

  await projects.remove(user.id, id);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function inviteProjectAction(fd: FormData) {
  const user = await requireUser();
  await invite({
    userId: user.id,
    projectId: num(fd, "project_id"),
    email: str(fd, "email"),
    lang: await getLang(),
  });
  revalidatePath("/account");
  revalidatePath("/", "layout");
}

export async function revokeProjectInviteAction(fd: FormData) {
  const user = await requireUser();
  await invitations.revokeOwned(user.id, num(fd, "invitation_id"), new Date().toISOString());
  revalidatePath("/account");
  revalidatePath("/", "layout");
}

export async function removeProjectMemberAction(fd: FormData) {
  const user = await requireUser();
  // Through the service: the person being removed has to be told, and their
  // id only exists on the row that is about to disappear.
  await collaboration.removeMember(user.id, num(fd, "membership_id"));
  revalidatePath("/account");
  revalidatePath("/", "layout");
}

export async function acceptProjectInviteAction(fd: FormData) {
  const user = await requireUser();
  // The token when the link supplied one, the id when it came from the list on
  // the account page. `accept` decides what each is worth.
  const slug = await accept({
    userId: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_verified_at),
    token: str(fd, "token") || undefined,
    invitationId: num(fd, "invitation_id") || undefined,
    lang: await getLang(),
  });
  if (!slug) redirect("/account?tab=invites&invite=failed");
  revalidatePath("/", "layout");
  redirect(`/p/${slug}`);
}

export async function acceptNewAccountInviteAction(fd: FormData) {
  const token = str(fd, "token");
  const result = token ? await acceptWithNewAccount(token, await getLang()) : null;
  if (!result) redirect("/invite?state=failed");
  await setSessionCookie(await auth.issueSession(result.user_id));
  revalidatePath("/", "layout");
  redirect(`/p/${result.access_slug}`);
}

/* ----------------------------------------------------------------- tasks */

export async function createTaskAction(fd: FormData) {
  const user = await requireUser();
  const slug = str(fd, "slug");
  const project = await projects.bySlug(user.id, slug);
  const title = str(fd, "title");
  if (!project || !title) return;
  await taskService.create({
    project_id: project.id,
    title,
    body: str(fd, "body") || null,
    priority: num(fd, "priority") || 2,
    actor: "human",
    user_id: user.id,
  });
  revalidatePath(`/p/${slug}`);
}

export async function setStatusAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "task_id");
  await assertTask(user.id, id);
  await taskService.update(
    id,
    { status: str(fd, "status") as Status },
    { actor: "human", user_id: user.id },
  );
  revalidatePath("/", "layout");
}

export async function updateTaskAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "task_id");
  await assertTask(user.id, id);
  await taskService.update(
    id,
    {
      title: str(fd, "title") || undefined,
      body: str(fd, "body") || null,
      priority: num(fd, "priority") || 2,
    },
    { actor: "human", user_id: user.id },
  );
  revalidatePath("/", "layout");
}

/* --------------------------------------------------------------- entries */

export async function addEntryAction(fd: FormData) {
  const user = await requireUser();
  const taskId = num(fd, "task_id");
  await assertTask(user.id, taskId);
  const body = str(fd, "body");
  if (!body) return;
  await taskService.addEntry({
    task_id: taskId,
    kind: str(fd, "kind") as EntryKind,
    body,
    author: "human",
    user_id: user.id,
  });
  revalidatePath("/", "layout");
}

export async function deleteEntryAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "entry_id");
  await assertEntry(user.id, id);
  await entries.remove(id);
  revalidatePath("/", "layout");
}

/* -------------------------------------------------------------- contexts */

export async function addContextAction(fd: FormData) {
  const user = await requireUser();
  const slug = str(fd, "slug");
  const project = slug ? await projects.bySlug(user.id, slug) : null;
  if (slug && !project) return;
  const title = str(fd, "title");
  const body = str(fd, "body");
  if (!title || !body) return;
  await contexts.create({
    user_id: user.id,
    project_id: project?.id ?? null,
    kind: str(fd, "kind") as ContextKind,
    title,
    body,
  });
  revalidatePath("/", "layout");
}

export async function deleteContextAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "context_id");
  await assertContext(user.id, id);
  await contexts.remove(id);
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------------------ refs */

export async function linkFileAction(fd: FormData) {
  const user = await requireUser();
  const taskId = num(fd, "task_id");
  await assertTask(user.id, taskId);
  const path = str(fd, "path");
  if (!path) return;
  await refs.link({ task_id: taskId, paths: [{ path, note: str(fd, "note") || null }] });
  revalidatePath("/", "layout");
}

export async function acceptRefAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "ref_id");
  await assertRef(user.id, id);
  await refs.acceptSeen(id);
  revalidatePath("/", "layout");
}

export async function unlinkRefAction(fd: FormData) {
  const user = await requireUser();
  const id = num(fd, "ref_id");
  await assertRef(user.id, id);
  await refs.unlink(id);
  revalidatePath("/", "layout");
}
