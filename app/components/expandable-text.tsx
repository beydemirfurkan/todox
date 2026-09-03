/**
 * A paragraph clamped to a few lines, with a control that shows the rest.
 *
 * The rails that list context notes have always clamped to four lines, and
 * until this existed nothing ever showed what was cut: the comment claiming
 * the full text was "one click away on hover/expand" described a control
 * nobody had built, and a note longer than four lines simply could not be read
 * in the app. That is the opposite of what the log is for.
 *
 * `<summary>` has to be the first child of `<details>` for the parser, and the
 * control belongs underneath the text it reveals, so the order is swapped in
 * the layout rather than in the markup. No JavaScript: `<details>` is the
 * disclosure widget the platform already ships, and it announces its own state.
 */
export function ExpandableText({
  text,
  more,
  less,
  className = "",
}: {
  text: string;
  more: string;
  less: string;
  className?: string;
}) {
  const body = `break-words whitespace-pre-wrap ${className}`;

  if (!isLongerThanTheClamp(text)) return <p className={body}>{text}</p>;

  return (
    <details className="group flex flex-col">
      <summary className="link-more order-2 mt-1.5 self-start">
        <span className="group-open:hidden">{more}</span>
        <span className="hidden group-open:inline">{less}</span>
      </summary>
      <p className={`line-clamp-4 group-open:line-clamp-none ${body}`}>{text}</p>
    </details>
  );
}

const CLAMPED_LINES = 4;

/**
 * Whether the clamp will actually bite, guessed from the text alone.
 *
 * It has to be a guess: the real answer depends on the rendered width, and the
 * server has none. Sixty characters is roughly a line in these rails. The two
 * ways to be wrong are not equal — a control on a note that already fits is a
 * word the reader ignores, while a missing one is text they cannot reach — so
 * the estimate is deliberately generous about offering it.
 */
function isLongerThanTheClamp(text: string): boolean {
  return text.length > CLAMPED_LINES * 60 || text.split("\n").length > CLAMPED_LINES;
}
