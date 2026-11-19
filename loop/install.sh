#!/bin/sh
# Copies the hooks to the loop home, outside the repo, so the agent runs a pinned copy it cannot edit (the PreToolUse guard refuses
# edits there). Run it again after changing the hooks. It registers nothing: add the entries in loop/settings.example.json yourself.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
home=${COHERENCE_LOOP_HOME:-$HOME/.config/coherence-loop}
mkdir -p "$home/bin/loop/hooks" "$home/bin/src/lib" "$home/state"
cp "$here/loop/work-order.ts" "$here/loop/approve.ts" "$home/bin/loop/"
cp "$here/loop/hooks/"*.ts "$home/bin/loop/hooks/"
cp "$here/src/lib/shell-commands.ts" "$home/bin/src/lib/"
[ -f "$home/work-order.json" ] || cp "$here/loop/work-order.example.json" "$home/work-order.json"
echo "Installed to $home/bin. Edit $home/work-order.json, then run: node $home/bin/loop/approve.ts"
