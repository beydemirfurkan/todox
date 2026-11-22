import { isAbsolutePath } from "../../lib/util/paths";
import { findProjectRoot, gitBranch, gitCommitsSince, gitDirtyCount, gitHead, gitRemote } from "../workspace";
import type { HookGit } from "./types";

/** The same git reads the stdio observer makes, on the machine with the checkout. */
export const workspaceGit: HookGit = {
  root: (path) => (isAbsolutePath(path) ? findProjectRoot(path) : undefined),
  head: gitHead,
  branch: gitBranch,
  dirty: gitDirtyCount,
  since: gitCommitsSince,
  remote: gitRemote,
};
