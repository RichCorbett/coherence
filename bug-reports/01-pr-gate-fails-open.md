# The PR gate allows the PR whenever it cannot judge it

**Severity:** HIGH. **Where:** `src/commands/pr-gate.ts:31-42`, `src/main.ts:26-31`, `tests/commands/pr-gate.test.ts:160-163`. **Found by:** all three passes (measured).

## What happens

Once `prCreateArgs` has recognised a `gh pr create`, every path where the gate cannot work out the commit returns `Exit.ok`:

- `Repo.open(...).catch(() => undefined)` turns every git failure into "no repo", then `if (!repo || !branch || !tip) return Exit.ok`. That covers permissions errors, a session folder outside the repo, a detached HEAD, and transient git errors.
- `--head owner:branch` is the normal gh form for a fork branch. It looks up `refs/heads/owner:branch`, finds nothing, and allows the PR. A `--head` naming any branch that is not local does the same. The test at `pr-gate.test.ts:160-163` asserts this as the intended behaviour.
- `JSON.parse` on the hook input is unguarded. A malformed payload throws, `main.ts` exits 3, and Claude Code treats a non-2 exit as non-blocking (inferred), so the PR goes ahead.

## Reproduce

On a branch with no review recorded, run `gh pr create --head someone:feature --fill`. The gate prints nothing and the PR is created.

## Expected

After a PR creation is recognised, any failure to resolve the repo, branch or tip should produce a deny decision with a reason. The "let through" test should become a fail-closed test.
