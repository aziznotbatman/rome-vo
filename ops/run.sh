#!/bin/bash
# Wrapper used by launchd: sets PATH, enters the project, prevents overlapping scrapes.
# Usage: ops/run.sh <pnpm script> [args...]
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/node@20/bin:/usr/bin:/bin"

if [[ "$1" == scrape* ]]; then
  LOCK="${TMPDIR:-/tmp}/romevo-scrape.lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    # A scrape is running; a lock older than 2h is stale (crashed run).
    if [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]]; then rm -rf "$LOCK"; mkdir "$LOCK"; else exit 0; fi
  fi
  trap 'rm -rf "$LOCK"' EXIT
fi

pnpm -s "$@" # no exec: the EXIT trap must run to release the lock
