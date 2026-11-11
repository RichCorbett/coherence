#!/bin/bash
# Same as the other cases, plus one rejection in the owner's taste log for the reviewer to honor.
set -e
cp -R "$(dirname "$0")/fixtures/repo/." .
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -q -m start
log="${XDG_CONFIG_HOME:-$HOME/.config}/coherence/taste-log.md"
# The eval gives each run a fresh temporary HOME and no XDG_CONFIG_HOME, so the log never exists yet.
# If it does, this is not that home: noclobber makes the write fail instead of overwriting it.
mkdir -p "$(dirname "$log")"
if ! (set -C; printf '%s\n' "- 2026-11-09 Don't flag a small hand-written deep clone; I'm fine keeping those instead of the standard library" > "$log"); then
  echo "refusing to overwrite existing $log" >&2
  exit 1
fi
