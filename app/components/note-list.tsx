import { isDeveloperKind, PINNED_BODY_MAX, PINNED_PER_SCOPE } from "@/lib/constants";
import type { T } from "@/lib/i18n";
import { ago } from "@/lib/i18n";
import type { Context } from "@/lib/types";
import { SubmitButton } from "../features/submit";
import { CONTEXT_KIND_COLOR, contextKindLabel } from "../kinds";
import { groupNotes } from "../note-groups";
import { Chip } from "./chip";

/** What a row can do. `publish` is offered only on account-wide notes, and
 *  `pin` only to whoever may decide what every session in the scope is shown. */
export interface NoteActions {
  remove: (formData: FormData) => Promise<void>;
  update: (formData: FormData) => Promise<void>;
  publish?: (formData: FormData) => Promise<void>;
  pin?: (formData: FormData) => Promise<void>;
}

/**
 * Standing notes, one line each, grouped by what they are.
 *
 * A note was a card: kind, a bold title that ran to five lines in a narrow
 * column, four lines of body and a toggle -- three hundred pixels for a
 * record whose title is the whole point of glancing at it. Now the title is
 * the line and the body is behind it, in a native `<details>` the keyboard
 * and a phone can open. Gotchas come first because they are what bites; the
 * chip on every row names the kind, so the groups need no headings of their
 * own. Past `NOTES_PER_KIND` a kind folds behind a count rather than being
 * cut -- the old rail showed six of twenty-two and said so in small type.
 *
 * Shared by the project page and the brain page, which is why the actions
 * arrive as a prop.
 */
export function NoteGroups({
  notes,
  t,
  actions,
}: {
  notes: Context[];
  t: T;
  actions: NoteActions;
}) {
  const pinsLeft = PINNED_PER_SCOPE - notes.filter((n) => n.is_pinned).length;
  return (
    <div className="space-y-3">
      {groupNotes(notes).map((group) => (
        <ul key={group.kind} className="space-y-1.5">
          {group.shown.map((c) => (
            <NoteRow key={c.id} note={c} t={t} actions={actions} pinsLeft={pinsLeft} />
          ))}
          {group.rest.length > 0 && (
            <li>
              <details>
                <summary className="link-more">{t("notesMore", { n: group.rest.length })}</summary>
                <ul className="mt-1.5 space-y-1.5">
                  {group.rest.map((c) => (
                    <NoteRow key={c.id} note={c} t={t} actions={actions} pinsLeft={pinsLeft} />
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      ))}
    </div>
  );
}

function NoteRow({
  note,
  t,
  actions,
  pinsLeft,
}: {
  note: Context;
  t: T;
  actions: NoteActions;
  pinsLeft: number;
}) {
  const publishable = actions.publish && note.project_id === null;
  return (
    <li>
      {/* The actions are plain once the note is open, not a `row-action`: the
          fold is already the gate, and an action that only appears on hover
          left an empty line under every opened body until the pointer found
          it. */}
      <details className="disclosure sticker-flat">
        <summary className="gap-x-2 gap-y-1 p-3">
          <Chip color={CONTEXT_KIND_COLOR[note.kind]}>{contextKindLabel(t, note.kind)}</Chip>
          <span className="line-clamp-2 min-w-0 flex-1 basis-48 text-[14px] font-semibold break-words text-ink">
            {note.title}
          </span>
          {note.is_pinned && <span className="mono shrink-0 text-meta text-accentInk">{t("pinned")}</span>}
          {publishable && note.is_public && (
            <span className="mono shrink-0 text-meta text-accentInk">{t("onProfile")}</span>
          )}
          <span className="mono ml-auto shrink-0 text-meta text-faint">{ago(note.updated_at, t)}</span>
        </summary>
        <div className="px-3 pb-3">
          <p className="text-small leading-relaxed break-words whitespace-pre-wrap text-muted">
            {note.body}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <NoteEditor note={note} t={t} update={actions.update} />
            {publishable && actions.publish && (
              <form action={actions.publish}>
                <input type="hidden" name="context_id" value={note.id} />
                <input type="hidden" name="public" value={note.is_public ? "0" : "1"} />
                <SubmitButton className="link-more text-meta" pendingLabel={t("working")}>
                  {note.is_public ? t("hideFromProfile") : t("showOnProfile")}
                  <span className="sr-only"> — {note.title}</span>
                </SubmitButton>
              </form>
            )}
            {actions.pin && <PinControl note={note} t={t} pin={actions.pin} pinsLeft={pinsLeft} />}
            <form action={actions.remove}>
              <input type="hidden" name="context_id" value={note.id} />
              <SubmitButton className="link-more text-meta" pendingLabel={t("working")}>
                {t("delete")}
                <span className="sr-only"> — {note.title}</span>
              </SubmitButton>
            </form>
          </div>
        </div>
      </details>
    </li>
  );
}

/** The button, or in a line why there is none. */
function PinControl({
  note,
  t,
  pin,
  pinsLeft,
}: {
  note: Context;
  t: T;
  pin: (formData: FormData) => Promise<void>;
  pinsLeft: number;
}) {
  // Every session is shown these already.
  if (isDeveloperKind(note.kind)) return null;
  const refusal = note.is_pinned
    ? null
    : note.body.replaceAll("\r\n", "\n").length > PINNED_BODY_MAX
      ? t("pinTooLong", { n: PINNED_BODY_MAX })
      : pinsLeft <= 0
        ? t("pinFull", { n: PINNED_PER_SCOPE })
        : null;
  if (refusal) return <span className="text-meta text-faint">{refusal}</span>;
  return (
    <form action={pin}>
      <input type="hidden" name="context_id" value={note.id} />
      <input type="hidden" name="pinned" value={note.is_pinned ? "0" : "1"} />
      <SubmitButton className="link-more text-meta" pendingLabel={t("working")}>
        {note.is_pinned ? t("unpinNote") : t("pinNote")}
        <span className="sr-only"> — {note.title}</span>
      </SubmitButton>
    </form>
  );
}

/**
 * The note's title and body as a form, behind its own fold. A plain form, so
 * it works without a script; the kind stays what it was -- changing what a
 * note is, is a new note.
 */
export function NoteEditor({
  note,
  t,
  update,
}: {
  note: Context;
  t: T;
  update: (formData: FormData) => Promise<void>;
}) {
  return (
    <details className="w-full">
      <summary className="link-more inline-flex text-meta">
        {t("editNote")}
        <span className="sr-only"> — {note.title}</span>
      </summary>
      <form action={update} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="context_id" value={note.id} />
        <label className="flex flex-col gap-1 text-meta text-faint">
          {t("title")}
          <input name="title" defaultValue={note.title} required maxLength={500} />
        </label>
        <label className="flex flex-col gap-1 text-meta text-faint">
          {t("noteBodyPh")}
          <textarea
            name="body"
            defaultValue={note.body}
            required
            rows={5}
            maxLength={note.is_pinned ? PINNED_BODY_MAX : undefined}
          />
        </label>
        <div>
          <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
        </div>
      </form>
    </details>
  );
}
