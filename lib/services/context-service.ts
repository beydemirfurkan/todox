import { isDeveloperKind, PINNED_BODY_MAX, PINNED_PER_SCOPE } from "../constants";
import { tx } from "../db/client";
import * as contexts from "../repositories/contexts";
import * as observations from "../repositories/observations";
import type { Context } from "../types";
import { BadRequest } from "./errors";
import { assertCanModifyContext, assertProject } from "./ownership";

/**
 * Writing a note, and marking the observation it came from.
 *
 * `addContext` lived in the RPC handler while it wrote one row, which was the
 * right place for it. Promotion makes it two rows in two tables that have to
 * agree, and sequencing those belongs here -- a handler that opens a
 * transaction is how the next handler comes to open a wider one.
 */

export async function addContext(
  input: contexts.NewContext & {
    /**
     * An unverified observation this note is written up from.
     *
     * The observation is the prompt, not the content: what is stored is what
     * the agent decided was worth keeping, in its own words. Marking it is
     * also what stops it arriving in the next briefing.
     */
    from_observation_id?: number;
  },
): Promise<Context> {
  const { from_observation_id, ...note } = input;

  // The common path is a note nobody is promoting, and it stays one query. A
  // transaction around a single insert is three round trips instead of one, on
  // a write agents are told to reach for often.
  if (from_observation_id == null) return contexts.create(note);

  const [rows] = await tx<Context>([
    contexts.createStmt(note),
    observations.promoteStmt(from_observation_id, note.kind),
  ]);
  return rows[0];
}

/**
 * Correct a note, or pin it. One place for both the agent's path and the
 * panel's, because what a pinned note may be has to hold whichever of them
 * edits it: pin first and lengthen second is the same note.
 */
export async function updateContext(
  userId: number,
  id: number,
  patch: contexts.ContextPatch,
): Promise<Context | undefined> {
  // `contexts.update` takes no user id -- this is the only thing standing
  // between a context id off the wire and somebody else's note.
  await assertCanModifyContext(userId, id);
  const note = await contexts.byId(id);
  if (!note) return undefined;
  const edited = { ...note, ...patch };
  if (isDeveloperKind(edited.kind) && note.project_id !== null) throw developerKindInProject(edited.kind);
  if (edited.is_pinned) assertPinnable(edited);
  if (edited.is_pinned && !note.is_pinned) await assertMayPin(userId, note);
  await contexts.update(id, patch);
  return contexts.byId(id);
}

export const developerKindInProject = (kind: string): BadRequest =>
  new BadRequest(
    `a ${kind} note describes the developer, not a project: omit project and cwd ` +
      "to write it account-wide, or use convention/preference for a project rule",
    "developer_kind_in_project",
  );

function assertPinnable(note: Pick<Context, "kind" | "body">): void {
  if (isDeveloperKind(note.kind))
    throw new BadRequest(`a ${note.kind} note is already shown to every session; it needs no pin`, "not_pinnable");
  // A form posts its line breaks as CRLF, and counts them as one character.
  const length = note.body.replaceAll("\r\n", "\n").length;
  if (length > PINNED_BODY_MAX)
    throw new BadRequest(
      `a pinned note is shown to every session, so its body may be ${PINNED_BODY_MAX} characters at most and this ` +
        `one has ${length}: shorten it to the rule itself, or unpin it`,
      "not_pinnable",
    );
}

/** The owner's call in a project, not any member's: it reaches everybody's sessions. */
async function assertMayPin(userId: number, note: Context): Promise<void> {
  if (note.project_id !== null) await assertProject(userId, note.project_id);
  if ((await contexts.countPinnedBeside(note)) >= PINNED_PER_SCOPE)
    throw new BadRequest(
      `${PINNED_PER_SCOPE} notes are already pinned ${note.project_id === null ? "account-wide" : "in this project"}: ` +
        "unpin one first (update_context with is_pinned: false)",
      "not_pinnable",
    );
}
