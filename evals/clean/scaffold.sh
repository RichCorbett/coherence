#!/bin/bash
# Eval runs start in an empty workspace, so each case brings its code as a real one-commit repository.
set -e
cp -R "$(dirname "$0")/fixtures/repo/." .
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -q -m start
