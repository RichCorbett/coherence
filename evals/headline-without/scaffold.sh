#!/bin/bash
# Both headline cases start from the clean bot on main, with the agent on a branch, so the change is exactly `git diff main`.
set -e
cp -R "$(dirname "$0")/../clean/fixtures/repo/." .
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -q -m start
git checkout -q -b feature
git config user.name eval
git config user.email eval@example.com
# Under plugin eval the plugin's bin/ is not on the agent's PATH, so headline-with's prompt runs this link to the copy under test.
# It sits outside the commit and in .git/info/exclude; headline-without's prompt never names it.
coherence="$(cd "$(dirname "$0")/../.." && pwd -P)/bin/coherence"
[ -x "$coherence" ] || { echo "scaffold: no executable at $coherence" >&2; exit 1; }
mkdir .coherence-bin
ln -s "$coherence" .coherence-bin/coherence
echo /.coherence-bin/ >> .git/info/exclude
