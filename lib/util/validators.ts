import {
  CONTEXT_KINDS,
  ENTRY_KINDS,
  STATUSES,
  type ContextKind,
  type EntryKind,
  type Status,
} from "../constants";

/** Lower and upper bound for `priority` on tasks. */
export const MIN_PRIORITY = -100;
export const MAX_PRIORITY = 100;

function has<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is Status {
  return has(STATUSES, value);
}

export function isOpenStatus(value: unknown): value is Status {
  return has(STATUSES, value) && value !== "done" && value !== "dropped";
}

export function isEntryKind(value: unknown): value is EntryKind {
  return has(ENTRY_KINDS, value);
}

export function isContextKind(value: unknown): value is ContextKind {
  return has(CONTEXT_KINDS, value);
}

export function isPriority(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PRIORITY &&
    value <= MAX_PRIORITY
  );
}

/**
 * Cast an `unknown` (the only honest shape after a `FormData.get`) to a Status.
 * Throws if the value is not one of the allowed strings -- the server-action
 * call sites catch this and surface it back to the form.
 */
export function asStatus(value: unknown): Status {
  if (!isStatus(value)) {
    throw new Error(`invalid status: ${JSON.stringify(value)}`);
  }
  return value;
}

export function asEntryKind(value: unknown): EntryKind {
  if (!isEntryKind(value)) {
    throw new Error(`invalid entry kind: ${JSON.stringify(value)}`);
  }
  return value;
}

export function asContextKind(value: unknown): ContextKind {
  if (!isContextKind(value)) {
    throw new Error(`invalid context kind: ${JSON.stringify(value)}`);
  }
  return value;
}

export function asPriority(value: unknown): number {
  if (!isPriority(value)) {
    throw new Error(
      `invalid priority: ${JSON.stringify(value)} (expected integer in ` +
        `[${MIN_PRIORITY}, ${MAX_PRIORITY}])`,
    );
  }
  return value;
}
