# Other findings, ranked

Severity is as adjudicated by the ACE-method pass. M = measured in the code, I = inferred.

## Eval validity

- **HIGH: eval answer leak (fixed).** The reviewer's instructions and the design rules used, as their example of overlapping names, the exact file names an eval fixture plants and its grader scores, so a reviewer could pass by pattern-matching. The examples now share no word with any fixture. The names are left out here on purpose, because the reviewer can read this folder (M).
- **HIGH: eval answer leak, second pass (fixed).** The first fix changed the words of the examples but kept their form. The examples are now removed by form as well; the rules state each class in plain words and give no instance. Described here without detail on purpose (M).
- **MED:** the fixture `ARCHITECTURE.md` files state, word for word, the answers that `stated-the-idea` and `kept-the-good-shape` look for (M).
- **MED:** no planted case has a precision grader, so "21 of 21" measures recall only. A report with 30 findings still passes (M).
- **MED:** `evals/baseline.md:24-26` shows the results table mixes two reviewer configurations, and the judge and the reviewer are both Sonnet (M).
- **Fixed (08c):** `evals/taste-applied/scaffold.sh` wrote the taste log with `>`. The eval docs say each scaffold runs with a fresh temporary `HOME` (relayed), so it should never meet a real log; the script now writes it with noclobber, so it can never overwrite an existing log. Accepted (Dissent round 2): run by hand outside the eval with no log yet, it still creates one in the real config folder; and a failed write can leave a partial log that blocks the next run.
- **INFO:** nothing measures the headline claim, "reads like one person wrote it". The review skill, `check` and the gate have no eval coverage (M).

## Taste

- **MED:** taste is a global, unauthenticated way to send instructions to the reviewer ("Follow it, including one that tells you to stop flagging something"). Fable traced four ways to poison it (M/I).
- **MED:** condensation drops dates and provenance, cannot be undone, and compounds earlier errors (M).
- **MED:** `appendTaste` accepts newlines, so one `add` can create several entries or fake headings (M).
- **LOW:** `condenseTaste` and `undoLastTaste` can lose updates when two agents write at once (M).

## Gate, remaining

- **MED:** a Bash-capable agent can forge `branch.<b>.coherence-reviewed` with `git config` (M).
- **MED:** the gate compares the local branch tip while gh publishes the remote branch (I).
- **MED:** in `shell-commands.ts`, the heredoc regex runs before quotes are parsed (`echo "<<EOF"` hides the next line), and `closingParen` ignores quotes (M).
- **LOW:** false denies: `# then gh pr create`, `echo gh pr create`, `gh pr create --help` (M).
- **LOW:** `gh api -X POST repos/o/r/pulls`, gh aliases and MCP tools bypass any Bash-text gate (I).
- **Fixed (07a):** the recorded base was never checked, so a review against `HEAD~1` or `main` also let a PR to any base open, and a too-recent `--base` from the caller shrank the reviewed change set (both left open by fix 04). The hook now requires a PR on a branch reviewed against a base to name `--base`, resolves it only as the local branch `refs/heads/<base>`, as gh reads it, and refuses when it is missing, is not a plain branch name, has no local branch, or is not at the reviewed base. A whole-repo review records the base `all` and still allows any; an approval with no readable base, including a head-only one left by earlier versions, is refused. The base is compared in the local clone, not on GitHub; that gap is accepted and documented in the README.

## Left open by fix 07b (Dissent round 4, 2026-11-11)

- **Fixed (07b):** an expanded `pr` or `create` (`gh pr $'create'`, `gh $(echo pr) create`, `"$GH" "$P" create`, options in between, extended globs such as `gh @(pr) create`) hid a PR from the gate. Any `gh` word followed by a word the shell could still change is now a candidate unless what follows is plainly another command (`gh api`, `gh repo`, `gh pr view`).
- **HIGH (accepted):** an expandable executable behind a wrapper, such as `env "$GH" "$P" create`, and a whole command in one variable (`$CMD`). The documented limit of a Bash-text gate (M).
- **LOW (accepted):** false denies on `$EDITOR $FILE` and on a mention such as `printf '%s' gh "$HOME"`. Both fail closed (M).

## Left open by fix 04 (Dissent round 4, 2026-11-11)

- **HIGH (accepted):** two `pass` calls on one branch can interleave, so a merge that started first can re-record an approval after a later `fix first` revoked it. Needs a branch lock or a review token from `review-input` (M).
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

- **Fixed (08b):** `hostile-repo.test.ts` tested both git flags in one case, so removing either alone still passed. Each flag now has its own plant that only it stops (bare repo + clean filter; nested repo + fsmonitor), and each test asserts the exact outcome, so an early failure no longer passes it. The stdin test now fails instead of hanging.
- **Refuted:** the claim that the TMPDIR test cannot fail. With npm 10.9.8, npx runs a literal `madge@8.0.0` from an ancestor `node_modules/.bin`, so the test fails when the defense is removed (measured by mutation).

## Docs

- Fixed by this commit: `ARCHITECTURE.md:8` listed a "missing architecture doc" check, which the code does not have (M).
