import { isAbsolutePath } from "../../lib/util/paths";
import type { ObserverGit } from "../observer";
import { findProjectRoot, gitBranch, gitCommitsSince, gitDirtyCount, gitHead } from "../workspace";

/** The same git reads the stdio observer makes, on the machine with the checkout. */
export const workspaceGit: ObserverGit = {
  root: (path) => (isAbsolutePath(path) ? findProjectRoot(path) : undefined),
  head: gitHead,
  branch: gitBranch,
  dirty: gitDirtyCount,
  since: gitCommitsSince,
};
