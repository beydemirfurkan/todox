import { tx } from "../db/client";
import * as contexts from "../repositories/contexts";
import * as observations from "../repositories/observations";
import type { Context } from "../types";

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
