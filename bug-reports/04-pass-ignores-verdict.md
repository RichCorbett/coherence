# `pr-gate pass` records a review whatever its verdict

**Severity:** HIGH. **Where:** `skills/review/SKILL.md:12`, `src/commands/pr-gate.ts:55-62`, `src/lib/repo.ts:77-80`. **Found by:** all three passes (measured).

## What happens

Step 3 of the review skill runs `coherence pr-gate pass` after reporting *any* review. It does so even when the deterministic checks found a cycle or the reviewer returned `fix first` or `rework`. `pass` takes no arguments and records `HEAD` in `branch.<name>.coherence-reviewed`.

The gate therefore proves that a review *ran*, not that it *approved* the commit. The code has no structured verdict to enforce, so a prose fix in SKILL.md alone could not be checked.

## Expected

- `pass` should require the verdict (`--verdict merge`) and refuse anything else.
- Before recording, `pass` should re-run the deterministic checks against the review base and refuse if they report findings.
- The skill should run `pass` only on a clean check and a `merge` verdict.

A Bash-capable agent can still forge the git config entry directly. That remains a known limit, recorded in [07-other-findings.md](07-other-findings.md).
