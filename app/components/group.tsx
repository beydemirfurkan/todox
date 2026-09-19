import { Counter } from "./chip";
import { PANEL_HEADER } from "./panel";

/**
 * A section that opens and closes, for a page that reads top to bottom.
 *
 * The project page used to be a two-column grid: the work on the left, a rail
 * of notes and a roster on the right. The rail was 19rem wide and every note
 * in it was a paragraph, so on the project with the most notes it ran to
 * 1,855px beside a task list of 661px, and below `lg` it stacked under sixty
 * task rows. A sticky rail was tried and cut cards in half (see the page).
 * The page now reads in the order the agent's briefing does, and each part of
 * it is one of these: a header that is always there, a body that is there
 * when it is open. Native `<details>`, so it works without JavaScript, the
 * keyboard toggles it, and the open state is markup.
 *
 * `Panel` cannot be reused for this: its header is a `<header>`, and a
 * details' first child must be the `<summary>`. The header classes are
 * shared instead, so the two look like one family.
 *
 * `right` is for a fact beside the count -- a chip that says "1 stuck" -- and
 * never a control: a button inside a `<summary>` is nested interactive
 * content, which is invalid and in Safari toggles the details instead.
 */
export function Group({
  id,
  title,
  count,
  countLabel,
  right,
  open = false,
  delay = 0,
  className = "",
  children,
}: {
  /** The heading's id; the details is labelled by it. */
  id: string;
  title: string;
  count: number;
  /** What `count` counts, for the counter's accessible name: "9 tasks". */
  countLabel: string;
  right?: React.ReactNode;
  open?: boolean;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      className={`disclosure sticker pop ${className}`}
      open={open}
      aria-labelledby={id}
      style={{ animationDelay: `${delay}ms` }}
    >
      <summary className={PANEL_HEADER}>
        <h2 id={id} className="display min-w-0 text-[16px] font-bold">
          {title}
        </h2>
        <Counter n={count} label={countLabel} />
        {right}
      </summary>
      <div className="border-t border-dashed border-rule p-4">{children}</div>
    </details>
  );
}
