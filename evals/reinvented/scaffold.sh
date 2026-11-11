#!/bin/bash
# Eval runs start in an empty workspace, so each case brings its code as a real one-commit repository.
set -e
cp -R "$(dirname "$0")/fixtures/repo/." .
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -q -m start
# Under plugin eval the plugin's bin/ is not on the agent's PATH, so the prompt runs this script, which starts the copy under test.
# It sits outside the commit and in .git/info/exclude, so git, and the checks that list files through it, leave it out.
coherence="$(cd "$(dirname "$0")/../.." && pwd -P)/bin/coherence"
mkdir .coherence-bin
printf '#!/bin/sh\nexec %q "$@"\n' "$coherence" > .coherence-bin/coherence
chmod +x .coherence-bin/coherence
echo /.coherence-bin/ >> .git/info/exclude
