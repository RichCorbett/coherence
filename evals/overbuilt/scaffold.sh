#!/bin/bash
# Eval runs start in an empty workspace, so each case brings its code as a real one-commit repository.
set -e
cp -R "$(dirname "$0")/fixtures/repo/." .
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -q -m start
# Under plugin eval the plugin's bin/ is not on the agent's PATH, so the prompt runs this link to the copy under test; bin/coherence follows links, and a link needs no quoting.
# It sits outside the commit and in .git/info/exclude, so git, and the checks that list files through it, leave it out.
coherence="$(cd "$(dirname "$0")/../.." && pwd -P)/bin/coherence"
mkdir .coherence-bin
ln -s "$coherence" .coherence-bin/coherence
echo /.coherence-bin/ >> .git/info/exclude
