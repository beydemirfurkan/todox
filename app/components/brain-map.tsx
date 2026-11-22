import { KIND_COLOR } from "../kinds";

/** One project as the map draws it. */
export interface BrainNode {
  slug: string;
  name: string;
  /** Entries written in the window. Sets the node's size. */
  activity: number;
  /** Open tasks. Sets the weight of the link to the centre. */
  open: number;
  decisions: number;
  deadEnds: number;
  questions: number;
}

const WIDTH = 720;
const HEIGHT = 380;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RX = 278;
const RY = 136;
/** Past this the ring is a crowd; the list beside the map has everyone. */
export const BRAIN_MAP_NODES = 12;

const SATELLITES = [
  { key: "decisions", color: KIND_COLOR.decision },
  { key: "deadEnds", color: KIND_COLOR.dead_end },
  { key: "questions", color: KIND_COLOR.question },
] as const;

/**
 * The developer in the middle and their projects around them.
 *
 * A node grows with what was written there lately, the line to it thickens
 * with what is still open, and three small dots say whether the project
 * holds decisions, dead ends and questions. A picture of where the thinking
 * is, drawn on the server as plain SVG -- no chart library, nothing to load.
 *
 * Hidden from assistive tech and from a phone: the list the page prints
 * beside it carries every number the drawing does, in words, and on a narrow
 * screen the labels would be too small to read anyway.
 */
export function BrainMap({ nodes, centre }: { nodes: BrainNode[]; centre: string }) {
  const shown = nodes.slice(0, BRAIN_MAP_NODES);
  const maxActivity = Math.max(1, ...shown.map((n) => n.activity));
  const maxOpen = Math.max(1, ...shown.map((n) => n.open));

  const placed = shown.map((node, i) => {
    // Start at the top and go round; an offset keeps two nodes off the
    // vertical axis, where their labels would sit on the centre's.
    const angle = -Math.PI / 2 + Math.PI / shown.length + (2 * Math.PI * i) / shown.length;
    return {
      node,
      x: CX + RX * Math.cos(angle),
      y: CY + RY * Math.sin(angle),
      r: 7 + 15 * Math.sqrt(node.activity / maxActivity),
      weight: 1 + 3 * (node.open / maxOpen),
    };
  });

  // The box is cut to what was drawn: two projects sit on one line, and a
  // fixed height left two thirds of the panel empty.
  const top = Math.min(CY - 40, ...placed.map((p) => p.y - p.r - 14));
  const bottom = Math.max(CY + 40, ...placed.map((p) => p.y + p.r + 26));

  return (
    <svg
      viewBox={`0 ${top} ${WIDTH} ${bottom - top}`}
      className="mx-auto hidden h-auto w-full max-w-[820px] sm:block"
      aria-hidden="true"
      focusable="false"
    >
      {placed.map(({ node, x, y, weight }) => (
        <line
          key={`l-${node.slug}`}
          x1={CX}
          y1={CY}
          x2={x}
          y2={y}
          stroke={node.open ? "var(--accent)" : "var(--line)"}
          strokeOpacity={node.open ? 0.45 : 1}
          strokeWidth={weight}
        />
      ))}

      {placed.map(({ node, x, y, r }) => (
        <g key={node.slug}>
          <circle cx={x} cy={y} r={r} fill="var(--inset)" stroke="var(--line)" strokeWidth={1.5} />
          {node.activity > 0 && (
            <circle cx={x} cy={y} r={Math.max(3, r - 5)} fill="var(--accent)" fillOpacity={0.18} />
          )}
          {SATELLITES.filter((s) => node[s.key] > 0).map((s, k) => {
            const a = -Math.PI / 4 + k * 0.7;
            return (
              <circle
                key={s.key}
                cx={x + (r + 6) * Math.cos(a)}
                cy={y + (r + 6) * Math.sin(a)}
                r={3.5}
                fill={s.color}
              />
            );
          })}
          <text
            x={x}
            y={y + r + 18}
            textAnchor="middle"
            fill="var(--muted)"
            fontSize={13}
            fontFamily="var(--font-dm-mono)"
          >
            {node.slug.length > 18 ? `${node.slug.slice(0, 17)}…` : node.slug}
          </text>
        </g>
      ))}

      <circle cx={CX} cy={CY} r={34} fill="var(--card)" stroke="var(--accent)" strokeWidth={2} />
      <text
        x={CX}
        y={CY + 6}
        textAnchor="middle"
        fill="var(--ink-head)"
        fontSize={17}
        fontWeight={600}
        fontFamily="var(--font-geist)"
      >
        {centre}
      </text>
    </svg>
  );
}
