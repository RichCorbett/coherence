# `git commit && gh pr create` publishes an unreviewed commit

**Severity:** HIGH. **Where:** `src/commands/pr-gate.ts:36-42`. **Found by:** ACE-method pass (measured). Neither Dissent nor the security review found it.

## What happens

The hook runs once, before the whole Bash line. It compares the branch tip at that moment with the recorded review. Anything earlier on the same line that moves the branch runs after the check.

1. `pr-gate pass` records commit X.
2. The agent runs `git add -A && git commit -m fix && git push && gh pr create --fill`, which is the usual agent one-liner.
3. The hook sees tip X, which matches the recorded review, and allows the line.
4. The commit creates Y, and the PR publishes Y, which nobody reviewed.

`shellCommands()` already lists every command on the line, but `pr-gate` only looks at the `gh` one. The test at `pr-gate.test.ts:33` uses this shape, but only on an unreviewed branch, so it denies for the wrong reason and never exercises the hole.

`cd ../other-repo && gh pr create` has the same root cause: the gate judges the session's folder, not the folder gh runs in.

## Expected

The gate should deny when the line that contains `gh pr create` also runs anything that can move HEAD or change folder (commit, merge, rebase, reset, pull, cherry-pick, am, revert, stash, switch, checkout, `cd`, `pushd`), and ask for `gh pr create` to be run on its own.
