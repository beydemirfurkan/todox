#!/bin/sh
# todox's Claude Code hooks: `run.sh <event>`, with the hook's JSON on stdin.
#
# The hooks are one node script with no dependencies. node is not guaranteed
# on a machine that runs Claude Code from its native installer, so without it
# a session still gets the reminder the plugin has always given at start, and
# every other hook does nothing -- a missing runtime must never cost the
# developer a blocked turn. Every failure inside the script exits 0 as well.
if ! command -v node >/dev/null 2>&1; then
  if [ "$1" = "session-start" ]; then
    echo "todox is connected. Before non-trivial work: get_context with cwd (it registers a new repo by itself). Before finishing: session_status with cwd, then update_task, dead_ends and a handoff on each task with handoff_missing."
  fi
  exit 0
fi
exec node "$(dirname "$0")/todox-hook.mjs" "$@"
