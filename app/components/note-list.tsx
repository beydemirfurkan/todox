import type { T } from "@/lib/i18n";
import { ago } from "@/lib/i18n";
import type { Context } from "@/lib/types";
import { SubmitButton } from "../features/submit";
import { CONTEXT_KIND_COLOR, contextKindLabel } from "../kinds";
import { groupNotes } from "../note-groups";
import { Chip } from "./chip";

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
 * Shared by the project page and the account-wide list on the home page,
 * which is why the delete action arrives as a prop.
 */
export function NoteGroups({
  notes,
  t,
  deleteAction,
}: {
  notes: Context[];
  t: T;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      {groupNotes(notes).map((group) => (
        <ul key={group.kind} className="space-y-1.5">
          {group.shown.map((c) => (
            <NoteRow key={c.id} note={c} t={t} deleteAction={deleteAction} />
          ))}
          {group.rest.length > 0 && (
            <li>
              <details>
                <summary className="link-more">{t("notesMore", { n: group.rest.length })}</summary>
                <ul className="mt-1.5 space-y-1.5">
                  {group.rest.map((c) => (
                    <NoteRow key={c.id} note={c} t={t} deleteAction={deleteAction} />
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
  deleteAction,
}: {
  note: Context;
  t: T;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <li>
      {/* The delete is plain once the note is open, not a `row-action`: the
          fold is already the gate, and an action that only appears on hover
          left an empty line under every opened body until the pointer found
          it. */}
      <details className="disclosure sticker-flat">
        <summary className="gap-x-2 gap-y-1 p-3">
          <Chip color={CONTEXT_KIND_COLOR[note.kind]} tilt={-2}>
            {contextKindLabel(t, note.kind)}
          </Chip>
          <span className="display line-clamp-2 min-w-0 flex-1 basis-48 text-[14.5px] font-bold break-words">
            {note.title}
          </span>
          <span className="mono ml-auto shrink-0 text-[11px] text-faint">
            {ago(note.updated_at, t)}
          </span>
        </summary>
        <div className="px-3 pb-3">
          <p className="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-muted">
            {note.body}
          </p>
          <form action={deleteAction} className="mt-2">
            <input type="hidden" name="context_id" value={note.id} />
            <SubmitButton className="link-more text-meta" pendingLabel={t("working")}>
              {t("delete")}
              <span className="sr-only"> — {note.title}</span>
            </SubmitButton>
          </form>
        </div>
      </details>
    </li>
  );
}
