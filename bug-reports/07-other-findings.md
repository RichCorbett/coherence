# Other findings, ranked

Severity is as adjudicated by the ACE-method pass. M = measured in the code, I = inferred.

## Eval validity

- **HIGH: eval answer leak (fixed).** The reviewer's instructions and the design rules used, as their example of overlapping names, the exact file names an eval fixture plants and its grader scores, so a reviewer could pass by pattern-matching. The examples now share no word with any fixture. The names are left out here on purpose, because the reviewer can read this folder (M).
- **MED:** the fixture `ARCHITECTURE.md` files state, word for word, the answers that `stated-the-idea` and `kept-the-good-shape` look for (M).
- **MED:** no planted case has a precision grader, so "21 of 21" measures recall only. A report with 30 findings still passes (M).
- **MED:** `evals/baseline.md:24-26` shows the results table mixes two reviewer configurations, and the judge and the reviewer are both Sonnet (M).
- **MED:** `evals/taste-applied/scaffold.sh:10` overwrites the real `~/.config/coherence/taste-log.md`, and `taste-capture` appends to it. Set `XDG_CONFIG_HOME` per case (M; whether the eval runner isolates HOME is inferred).
- **INFO:** nothing measures the headline claim, "reads like one person wrote it". The review skill, `check` and the gate have no eval coverage (M).

## Taste

- **MED:** taste is a global, unauthenticated way to send instructions to the reviewer ("Follow it, including one that tells you to stop flagging something"). Fable traced four ways to poison it (M/I).
- **MED:** condensation drops dates and provenance, cannot be undone, and compounds earlier errors (M).
- **MED:** `appendTaste` accepts newlines, so one `add` can create several entries or fake headings (M).
- **LOW:** `condenseTaste` and `undoLastTaste` can lose updates when two agents write at once (M).

## Gate, remaining

- **MED:** a Bash-capable agent can forge `branch.<b>.coherence-reviewed` with `git config` (M).
- **MED:** `--base` is not recorded, so a review against `main` also covers a PR to `production` (M).
- **MED:** the gate compares the local branch tip while gh publishes the remote branch (I).
- **MED:** in `shell-commands.ts`, the heredoc regex runs before quotes are parsed (`echo "<<EOF"` hides the next line), and `closingParen` ignores quotes (M).
- **LOW:** false denies: `# then gh pr create`, `echo gh pr create`, `gh pr create --help` (M).
- **LOW:** `gh api -X POST repos/o/r/pulls`, gh aliases and MCP tools bypass any Bash-text gate (I).

## Left open by fix 04 (Dissent round 4, 2026-11-11)

- **HIGH (accepted):** two `pass` calls on one branch can interleave, so a merge that started first can re-record an approval after a later `fix first` revoked it. Needs a branch lock or a review token from `review-input` (M).
- **HIGH (accepted):** `--base` is chosen by the caller. A base that is a descendant of HEAD, or any too-recent base, shrinks the reviewed change set. The real fix is checking the recorded base at PR time, listed above (M).
- **MED:** `--branch` uses the narrow `SAFE_REF`, so valid branch names with `+` or `@` can never be approved. This fails closed, but an approval left by older code on such a branch could not be revoked (M).
- **MED:** `git status --porcelain` follows `status.showUntrackedFiles=no`, which would hide untracked files from the clean-tree check. Pass `--untracked-files=all` (M).
- **MED:** a `--base` that no longer resolves throws instead of returning a `pass refused` reason. It still exits non-zero and records nothing (M).
- **LOW:** a successful `pass` revokes twice (M).
- **Accepted:** a file edited and put back while the checks run (noted in the code and the README).

## Left open by fix 02 (Dissent round 4, 2026-11-11)

- **HIGH (accepted):** the allowed body form `"$(cat <<'EOF' ... EOF)"` runs `cat` after the gate decides. A `cat` function or PATH entry set earlier in the session could change HEAD first. Same class as aliases and functions defined earlier. Removing the form would refuse Claude Code's standard PR command (M/I).
- **Accepted, documented in the README:** a Bash-text gate cannot see every disguise: `gh $A create`, `$CMD`, base64, `gh api`. Hard enforcement belongs to GitHub branch protection with a required check.
- **MED:** the hook's stdin read has no timeout (with the other timeouts above) (M).
- **MED:** the gh option table is from gh 2.103.2. A new gh option is refused until it is added; this fails closed (M).
- **LOW:** any mention of `gh pr create`, such as `grep -rn "gh pr create"` or a commit message naming it, is refused (M).

## Checks and processes

- **MED:** `runProcess` has no timeout, and a failed check does not cancel the others (M).
- **MED:** `npx --yes madge@8.0.0 / jscpd@5.4.3` pins only the top-level version. Transitive dependencies and their install scripts are fetched per machine (M).
- **MED:** concurrent `npx` runs race on a cold npm cache. Reproduced 2026-11-11 on a machine that had never fetched the tools: the test suite's first run failed 2 of 41 tests. npm reported `EEXIST: file already exists, symlink ... ~/.npm/_npx/.../node_modules/.bin/parser` and `madge failed: sh: madge: command not found`. The next two runs passed 41 of 41. Two `coherence check` runs started together on a fresh machine fail in the same way. Installing the tools once from a lockfile fixes this together with the unpinned-dependency item above (measured).
- **MED:** one argument per file can hit ARG_MAX on big repos. This fails loudly, not as a false pass (M/I).
- **MED:** in a folder that already has more than 15 files, touching one file makes the whole folder a must-fix for the branch (M).
- **MED:** madge gets no `--ts-config`, so cycles through path aliases are missed (I).
- **MED:** `sourceFiles()` uses `git ls-files`, so untracked files are never checked (M).
- **LOW:** any folder named `build`, `dist`, `vendor` or `fixtures` anywhere in the tree is skipped (M).

## Tests that cannot fail

- `hostile-repo.test.ts`: the TMPDIR test cannot fail. The code uses `~/.cache`, and the planted bins are named `madge@8.0.0`, which npx never looks up (M). The fsmonitor half would likely pass with the defense removed (I).

## Docs

- Fixed by this commit: `ARCHITECTURE.md:8` listed a "missing architecture doc" check, which the code does not have (M).
