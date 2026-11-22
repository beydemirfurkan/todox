/**
 * What a page looks like before its data arrives: the same column, a heading
 * bar and the rows it is about to fill, so the switch to the real page moves
 * nothing. Every page behind the sign-in reads the database over the network,
 * and without this a click on the sidebar did nothing visible until the whole
 * next page had been rendered.
 *
 * The bars are decorative; the one thing a screen reader hears is the label.
 */

export type SkeletonShape = "list" | "task" | "report";

const ROW_WIDTHS = ["72%", "58%", "84%", "64%", "76%", "52%"];

export function PageSkeleton({ label, shape = "list" }: { label: string; shape?: SkeletonShape }) {
  return (
    <div className="skeleton-page" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="skeleton-bar h-8 w-[min(16rem,60%)]" />
          <span className="skeleton-bar h-4 w-[min(28rem,85%)]" />
        </div>
        {shape === "report" && <ReportFigures />}
        {shape === "task" ? <TaskBody /> : <Rows count={6} />}
      </div>
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="sticker flex flex-col">
      {ROW_WIDTHS.slice(0, count).map((width, i) => (
        <div key={i} className="flex flex-col gap-2 border-t border-rule px-5 py-4 first:border-t-0">
          <span className="skeleton-bar h-4" style={{ width }} />
          <span className="skeleton-bar h-3 w-[30%]" />
        </div>
      ))}
    </div>
  );
}

/** The period pills, then the figures that sit in pills under them. */
function ReportFigures() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="skeleton-bar h-9 w-20 rounded-full" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skeleton-bar h-8 w-28 rounded-full" />
        ))}
      </div>
    </div>
  );
}

function TaskBody() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex flex-col gap-4">
        <span className="skeleton-bar h-11 w-full max-w-[26rem] rounded-xl" />
        <div className="sticker flex flex-col gap-2.5 p-5">
          <span className="skeleton-bar h-3 w-24" />
          <span className="skeleton-bar h-4 w-[90%]" />
          <span className="skeleton-bar h-4 w-[70%]" />
        </div>
        <Rows count={4} />
      </div>
      <div className="sticker hidden flex-col gap-3 p-5 lg:flex">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skeleton-bar h-3.5" style={{ width: ROW_WIDTHS[i] }} />
        ))}
      </div>
    </div>
  );
}
