import { Blob, Chip, Counter, Panel } from "../../components";

/**
 * The route is `force-dynamic`, so this skeleton is what shows while the
 * page is rebuilding after any server-action write, not while the DB is cold.
 * The layout matches the real page in shape: header, stale banner slot,
 * filter row, the flow panel, then a column of task rows.
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <header className="pop space-y-2">
        <span className="skel skel-line !w-32" />
        <span className="skel skel-block !w-72" />
        <span className="skel skel-line !w-96" />
      </header>

      <Panel delay={40} title={<span className="skel skel-line !w-32" />}>
        <div className="flow" aria-hidden="true">
          <div className="flow-parent">
            <div className="sticker-flat p-3">
              <div className="flex items-center gap-2">
                <Blob mood="sleep" size={28} fill="var(--inset)" stroke="var(--ink)" />
                <span className="skel skel-line !w-32" />
                <Chip>
                  <span className="skel skel-line !w-10" />
                </Chip>
              </div>
            </div>
          </div>
          <div className="flow-bus" />
          <div className="flow-children">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flow-child">
                <div className="flow-stem" />
                <div className="sticker-flat space-y-2 p-3">
                  <span className="skel skel-line !w-32" />
                  <span className="skel skel-line !w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="sticker-flat flex items-center gap-3 p-3">
            <Blob mood="idle" size={24} fill="var(--inset)" stroke="var(--ink)" />
            <span className="skel skel-line flex-1" />
            <span className="skel skel-line !w-16" />
          </div>
        ))}
        <p className="text-[12.5px] text-faint">
          <Counter n={0} label="…" />
        </p>
      </div>
    </div>
  );
}