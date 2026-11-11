# Dogfood review: coherence's own reviewer on its own code

**Severity:** MED and LOW, coherence only; no security or correctness finding. **Where:** `main` at `1c355f7`. **Found by:** `/coherence:review` over the whole repository, 2026-11-11 16:52 EST. The rule checks were clean; the `coherence:readability-reviewer` agent called it **fix first**.

Measured means I checked it in the source. The rest is the reviewer's reading, not yet checked.

## 1. `pr-gate.ts` holds five jobs (MED)

**Where:** `src/commands/pr-gate.ts`, 296 lines (measured). The other commands are 13 to 59 lines (measured).

### What happens

One command file holds a shell-line sniffer (`opensPr`), the `gh pr create` option parser (`options`, the `TAKES_VALUE` and `SWITCHES` tables), hook-payload parsing, the PreToolUse gate (`judge`, `baseMismatch`), and the `pass` verb that records a review. The rule "refuse a PR that has had no review" is buried under flag grammar. Most of the growth came from today's gate fixes 02, 04, 07a and 07b.

### Expected

- Move `opensPr`, the option parser and `hookInput` into `src/lib/gh-pr-create.ts`, beside `src/lib/shell-commands.ts`, which does the same kind of work.
- Move `pass` into its own command, or into `src/lib/review-record.ts`, so `pr-gate` only gates.
- Keep the long record of rejected designs above `opensPr`. It moves with the function.

## 2. `pr-gate` gets `check` handed to it, then re-reads its exit code (MED)

**Where:** `src/main.ts:9-10`, `src/commands/pr-gate.ts:154-160`, `src/commands/check.ts`.

### What happens

Commands may not import each other, so `main.ts` passes a `CheckCommand` into `PrGateCommand`. `pass` runs it and reads its numeric exit code, because `check` prints its findings instead of returning them.

### Expected

Add `runChecks(repo, base?)` to `src/checks/index.ts`, holding the check list and the branch-scope filter and returning the findings. `check` prints them, `pass` calls the function directly, and `main.ts` goes back to `new PrGateCommand()`.

## 3. `repo.ts` also holds the review ledger (MED)

**Where:** `src/lib/repo.ts`.

### What happens

`Repo` is "the git repository under review", but it also stores and revokes approvals in git config (`reviewedCommit`, `reviewedBase`, `markCommitReviewed`, `revokeReview`, `WHOLE_REPO`). The rule that an approval is written head, then base, last, is split between this file and `pr-gate.ts`. `Repo.exists` (`src/lib/repo.ts:155`) has no caller (measured).

### Expected

Move the ledger to `src/lib/review-record.ts`, built on `Repo`, together with finding 1's `pass`. Delete `Repo.exists`.

## 4. ARCHITECTURE.md claims a scope the code lacks (LOW)

**Where:** `ARCHITECTURE.md:30` says "scope (file, folder or repo)". `src/lib/base-check.ts:4` is `"file" | "folder"` (both measured).

### Expected

Say "file or folder".

## 5. One value with two names, one limit written twice (LOW)

- `src/commands/review-input.ts:55` writes the cache prefix `"review-"` as a bare string, while `PATCH_FOLDER_PREFIX` declares it. Use the constant.
- `src/commands/review-input.ts:40` writes "over 3000 lines or 200 KB" by hand beside `PASTE_LIMIT_LINES` and `PASTE_LIMIT_BYTES`. Build the message from the constants.
- `src/lib/process.ts` runs child processes, runs pinned npx tools and manages the cache folder. Moving the cache functions to `src/lib/cache.ts` is optional.

## 6. Usage errors handled several ways (LOW)

**Where:** `src/commands/taste.ts`, `src/commands/pr-gate.ts`.

### What happens

Each file defines its own private `refuse()`, which prints usage and returns `Exit.usage`. `pr-gate` adds `refusePass` and `cannotCheck`. `check` and `review-input` each repeat the same `parseArgs` for `--base`.

### Expected

Put one `usageError(invocation)` in `BaseCommand`, beside `deny`, and use it in both commands.

## 7. Stacked comments and a typo in `pr-gate.ts` (LOW)

**Where:** `src/commands/pr-gate.ts:7-9` and `:43`.

### What happens

`COULD_EXPAND` and `COULD_BE_GH` sit under two stacked doc comments. Line 43 reads `anchor &&expandsLater` (measured).

### Expected

One comment per constant, and a space after `&&`.

## What the reviewer said to keep

- One shape per kind: `BaseCommand` and `BaseCheck`, with the `CHECKS` and `COMMANDS` tables.
- `tests/architecture.test.ts` enforces the layer order. madge covers type-only cycles, which that test cannot see.
- Comments that give reasons, reuse of madge, jscpd and `parseArgs`, and an `ARCHITECTURE.md` that traces the three flows end to end.
