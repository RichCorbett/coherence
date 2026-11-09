#!/bin/bash
# Same as the other cases, plus one rejection in the owner's taste log for the reviewer to honor.
set -e
cp -R "$(dirname "$0")/fixtures/repo/." .
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -q -m start
log="${XDG_CONFIG_HOME:-$HOME/.config}/coherence/taste-log.md"
mkdir -p "$(dirname "$log")"
echo "- 2026-11-09 Don't flag a small hand-written deep clone; I'm fine keeping those instead of the standard library" > "$log"
