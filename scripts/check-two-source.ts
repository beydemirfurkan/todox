/**
 * Holds the domain rules in `AGENTS.md` and `CONTRIBUTING.md` to each other.
 *
 * The duplication is deliberate: Codex and Cursor read `AGENTS.md` as plain
 * markdown and will not follow a cross-file reference, so the rules have to be
 * where each reader already is. What was not deliberate is that the two copies
 * had drifted -- `CONTRIBUTING.md` carried a paragraph about hashing files in
 * request handlers that `AGENTS.md` had lost -- and the only thing guarding
 * against it was a checkbox in the pull request template.
 *
 * A checkbox cannot notice. This can, and it costs one CI step.
 *
 * Whitespace is normalised before comparing. The rule is about the words: the
 * two files wrap at different widths and always have, and a check that fails
 * on a re-wrap is a check people learn to override.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Where the mirrored section starts and stops in each file. */
const SECTIONS = [
  {
    file: "AGENTS.md",
    from: "- **Repositories never call each other.**",
    to: "## Cross-file workflows",
  },
  {
    file: "CONTRIBUTING.md",
    from: "- **Repositories never call each other.**",
    to: "## The one thing worth arguing about",
  },
] as const;

function section({ file, from, to }: (typeof SECTIONS)[number]): string {
  const text = readFileSync(join(ROOT, file), "utf8");
  const start = text.indexOf(from);
  if (start === -1) throw new Error(`${file}: the domain rules do not start with "${from}"`);
  const end = text.indexOf(to, start);
  if (end === -1) throw new Error(`${file}: no "${to}" after the domain rules`);
  return text.slice(start, end);
}

/** One space for any run of whitespace, so wrapping is not the thing compared. */
const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

/** The first place they diverge, with enough either side to recognise it. */
function divergence(left: string, right: string): string {
  const at = [...left].findIndex((ch, i) => ch !== right[i]);
  const where = at === -1 ? Math.min(left.length, right.length) : at;
  const window = (text: string) => text.slice(Math.max(0, where - 120), where + 120);
  return [
    `They agree for ${where} characters, then:`,
    "",
    `  AGENTS.md       …${window(left)}…`,
    "",
    `  CONTRIBUTING.md …${window(right)}…`,
  ].join("\n");
}

const [agents, contributing] = SECTIONS.map((s) => normalise(section(s)));

if (agents !== contributing) {
  console.error(
    [
      "The domain rules in AGENTS.md and CONTRIBUTING.md have drifted apart.",
      "",
      "They are duplicated on purpose -- Codex and Cursor read AGENTS.md",
      "directly and will not follow a reference to another file -- so a change",
      "to one is a change to the other.",
      "",
      divergence(agents!, contributing!),
    ].join("\n"),
  );
  process.exit(1);
}

console.log("AGENTS.md and CONTRIBUTING.md agree on the domain rules");
