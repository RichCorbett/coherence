# Bug reports

Drafted 2026-11-11 from an adversarial review of `main` at `8622838`. Three passes:

1. Dissent, a five-persona model review (Codex models)
2. A read-only security review (Claude)
3. An ACE-method pass (Fable) that traced each claim, tried to refute it, and then adjudicated

All claims come from reading the code. None were reproduced by running it. "Measured" means traced in the source, "inferred" means it depends on how Claude Code, gh, npx or madge behave.

| File | Severity | Summary |
|---|---|---|
| [01-pr-gate-fails-open.md](01-pr-gate-fails-open.md) | HIGH | The gate allows the PR whenever it cannot judge it |
| [02-pr-gate-check-before-commit.md](02-pr-gate-check-before-commit.md) | HIGH | `git commit && gh pr create` publishes an unreviewed commit |
| [03-deny-message-coaches-self-approval.md](03-deny-message-coaches-self-approval.md) | HIGH | The deny message tells the agent how to approve itself |
| [04-pass-ignores-verdict.md](04-pass-ignores-verdict.md) | HIGH | `pr-gate pass` records a review whatever its verdict |
| [05-reviewer-has-bash.md](05-reviewer-has-bash.md) | HIGH | The reviewer reads untrusted repos with unrestricted Bash |
| [06-hook-filter-too-literal.md](06-hook-filter-too-literal.md) | HIGH | The hook's `*gh pr create*` filter misses equivalent commands |
| [07-other-findings.md](07-other-findings.md) | MED and LOW | Everything else, ranked |
