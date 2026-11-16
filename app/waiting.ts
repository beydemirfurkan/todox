import { quietDays } from "./p/[slug]/board";

/**
 * What is waiting on the person, across every project they can see.
 *
 * Three things stop without them: a question nobody has answered, a task
 * somebody marked blocked, and a task left in 'doing' with nothing written
 * since. The agent that hit each one has ended its session, so none of them
 * moves until a person looks -- and until now each was visible only from
 * inside the project it happened in.
 *
 * The two queries arrive longest-waiting first and already cut; this puts
 * them in one list and says how many it left out.
 */

export type WaitingKind = "question" | "blocked" | "quiet";

export interface WaitingItem {
  kind: WaitingKind;
  taskId: number;
  projectId: number;
  title: string;
  /** The question's first lines. A stalled task has nothing more to say. */
  detail: string | null;
  /** When it started waiting. */
  since: string;
  /** Whole days in 'doing' with nothing written; only a quiet task has one. */
  quietDays: number | null;
}

interface QuestionRow {
  task_id: number;
  project_id: number;
  task_title: string;
  body: string;
  created_at: string;
}

interface StalledRow {
  id: number;
  project_id: number;
  title: string;
  status: "todo" | "doing" | "blocked" | "done" | "dropped";
  updated_at: string;
}

export interface WaitingInput {
  questions: { rows: readonly QuestionRow[]; total: number };
  stalled: { rows: readonly StalledRow[]; total: number };
  limit: number;
  now: Date;
}

/**
 * Questions first: a question is addressed to the reader by name, a stalled
 * task is only inferred to be theirs. A task that is stalled *because* of a
 * question shown above it is not listed twice, and neither is a task with two
 * open questions: the oldest stands for it, and the rest are counted.
 *
 * `omitted` counts what the list does not show, from the totals the queries
 * report rather than from the rows they returned, so a list cut at six of
 * sixty says fifty-four and not zero.
 */
export function waitingItems(input: WaitingInput): { items: WaitingItem[]; omitted: number } {
  const asked = new Set(input.questions.rows.map((question) => question.task_id));
  const repeated = input.stalled.rows.filter((task) => asked.has(task.id)).length;

  const firstPerTask = input.questions.rows.filter(
    (question, index, rows) => rows.findIndex((row) => row.task_id === question.task_id) === index,
  );
  const questions: WaitingItem[] = firstPerTask.map((question) => ({
    kind: "question",
    taskId: question.task_id,
    projectId: question.project_id,
    title: question.task_title,
    detail: question.body,
    since: question.created_at,
    quietDays: null,
  }));
  const stalled: WaitingItem[] = input.stalled.rows
    .filter((task) => !asked.has(task.id))
    .map((task) => ({
      kind: task.status === "blocked" ? "blocked" : "quiet",
      taskId: task.id,
      projectId: task.project_id,
      title: task.title,
      detail: null,
      since: task.updated_at,
      quietDays: quietDays(task, input.now),
    }));

  const items = [...questions, ...stalled].slice(0, input.limit);
  const waiting = input.questions.total + input.stalled.total - repeated;
  return { items, omitted: Math.max(0, waiting - items.length) };
}
