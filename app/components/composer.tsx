import { ClosePopoverAfterSubmit } from "../features/close-popover-after-submit";

/**
 * The "+" on a group's header, and the form it opens.
 *
 * The trigger cannot live in the `<summary>`: a button there is nested
 * interactive content, and Safari answers a click on it by toggling the
 * group. So `Group` places it over the header's right edge as a sibling of
 * the details, and the form is a native popover -- no script, Esc and a
 * click outside close it, and it opens while the group is folded. Where the
 * browser can anchor a popover to its invoker the form drops down under the
 * "+" like a menu; elsewhere it is a card in the middle of the screen.
 *
 * The form is this component's, not the caller's, because two things about
 * it are the popover's business: the first field carries `autoFocus`, which
 * the server renders as the attribute the popover algorithm delegates focus
 * to; and the popover has to close once the action has run, which a form
 * that stayed a plain `<form action>` would not do on its own.
 */
export function Composer({
  id,
  label,
  action,
  children,
}: {
  /** The popover's id; the trigger targets it. */
  id: string;
  /** The accessible name of the "+", which is otherwise a glyph. */
  label: string;
  action: (formData: FormData) => Promise<void>;
  /** The form's fields. Put `autoFocus` on the first one. */
  children: React.ReactNode;
}) {
  return (
    <>
      <button type="button" className="composer-trigger" popoverTarget={id} aria-label={label}>
        <span aria-hidden="true">+</span>
      </button>
      <div id={id} popover="auto" className="composer sticker" aria-label={label}>
        <form action={action} className="space-y-2">
          {children}
          <ClosePopoverAfterSubmit />
        </form>
      </div>
    </>
  );
}
