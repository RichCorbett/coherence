import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { HOOK_DEADLINE_MS, PrGateCommand } from "../../src/commands/pr-gate.ts";
import { BaseCommand, Exit } from "../../src/lib/base-command.ts";
import { resumeRunning } from "../../src/lib/process.ts";
import { markCommitReviewed, reviewedCommit } from "../../src/lib/review-record.ts";
import { setEnv, tempFolder, writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

/** The gate wired as main.ts wires it. */
function gate() {
  return new PrGateCommand(new CheckCommand());
}

async function runHook(cwd: string, command: string) {
  const invocation = fakeInvocation(cwd, [], JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command } }));
  assert.equal(await gate().execute(invocation), Exit.ok);
  return invocation.printed;
}

/** Runs `pr-gate pass` with exactly `args`, and returns the exit code and the one-line reason it printed. */
async function passWith(cwd: string, args: string[]) {
  const invocation = fakeInvocation(cwd, ["pass", ...args]);
  const code = await gate().execute(invocation);
  return { code, error: invocation.errors.join("\n") };
}

/** The arguments the review skill passes for a merge of the branch and commit checked out now. */
function mergeOfHead(cwd: string): string[] {
  return ["--branch", git(cwd, "branch", "--show-current"), "--verdict", "merge", "--head", git(cwd, "rev-parse", "HEAD")];
}

/** Records a merge verdict for the commit now at HEAD, as the review skill does. */
async function pass(cwd: string, ...extra: string[]) {
  return (await passWith(cwd, [...mergeOfHead(cwd), ...extra])).code;
}

function recorded(cwd: string, key: string, branch = "feature"): string | undefined {
  try {
    return git(cwd, "config", "--get", `branch.${branch}.${key}`);
  } catch {
    return undefined;
  }
}

async function reviewedIntegrationBranch() {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "integration");
  await pass(repo.root);
  return repo;
}

const CYCLE = {
  "src/a/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
  "src/a/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
};

test("lets every other shell command through without asking git anything", async () => {
  assert.deepEqual(await runHook(tempFolder(), "gh pr list"), []);
});

test("ordinary commands are let through, and a mention of gh pr create, even in quoted text, is refused", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const command of [`git commit -m "fix typo"`, "npm test", "git log --oneline", "gh pr view 3", "gh pr list", `bash -c "npm run pr-check"`, "cat notes-about-gh pr create"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
  // Recognition reads the raw text, so it cannot tell a mention from a hidden command; a mention is the false deny this costs.
  for (const command of [`git commit -m "document gh pr create"`, `echo 'gh pr create'`, `grep -rn "gh pr create" src`]) {
    assert.match(refusal(await runHook(repo.root, command)), /not exactly one gh pr create command/, command);
  }
});

test("gh pr create hidden in a heredoc body, an eval, a nested shell or a substitution is refused", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  await pass(repo.root);
  for (const command of [
    "cat <<EOF\n$(gh pr create --head other --title t --body b)\nEOF",
    "eval 'gh pr create --head other'",
    "sh -c 'gh pr create --head other'",
    "$(printf 'gh pr create --head other')",
    `eval "$(echo g)h pr create --head other"`,
    `sh -c "$(printf 'g%s pr create' h)"`,
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), /not exactly one gh pr create command/, command);
  }
});

test("a PR opened after a shell separator or environment assignment is still refused", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const command of ["gh pr create --fill", "cd sub; gh pr create", "git push | gh pr create", "GH_TOKEN=abc gh pr create", "(gh pr create)", "ls\ngh pr create", `git commit -m "note" && gh pr create`]) {
    assert.equal((await runHook(repo.root, command)).length, 1, command);
  }
});

test("a PR opened through a wrapper, a path, a nested shell or a substitution is still refused", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const command of [
    `sh -c "gh pr create"`,
    `bash -lc 'gh pr create'`,
    `eval "gh pr create"`,
    "echo `gh pr create`",
    "command gh pr create",
    "env gh pr create",
    "time gh pr create",
    "nohup gh pr create",
    "xargs gh pr create",
    "/usr/bin/gh pr create",
    "{ gh pr create; }",
    "if true; then gh pr create; fi",
    "! gh pr create",
    `echo "$(gh pr create)"`,
    "URL=$(gh pr create --fill)",
    "gh -R o/r pr create",
  ]) {
    assert.equal((await runHook(repo.root, command)).length, 1, command);
  }
});

test("a PR whose pr or create word is an expansion is refused, and ordinary commands stay allowed", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const command of ["gh pr $'create' --fill", "gh $(echo pr) create --fill", `gh "$P" create`, "gh pr ${C}", "gh -R o/r $(printf pr) create --fill", `gh --repo o/r "$P" create`, "gh pr -R o/r $(printf create) --fill", "env gh pr $'create'", "command gh $(echo pr) create", `time gh "$P" create`, "sudo -u x gh pr ${C}", `/usr/bin/env gh "$P" create`, `/usr/bin/sudo gh pr "$A"`, `sudo -Eu user gh "$P" create`, `A+=x gh "$P" create`, "nice -n 5 gh $(printf pr) create", "gh @(pr) create", "gh pr @(create)", "gh pr +(create) --fill",
    // An expandable first word could be gh.
    `"$GH" "$P" create --fill`, `$GH pr "$C" --fill`, `"$GH" --repo o/r "$P" create`, `g[h] "$P" create --fill`, "g[h] pr $(printf create) --fill",
    // A mention of gh next to an expansion is refused, like any other mention.
    `printf '%s %s' gh "$HOME"`, `echo gh "$HOME"`]) {
    assert.match(refusal(await runHook(repo.root, command)), /not exactly one gh pr create command/, command);
  }
  for (const command of [`git commit -m "fix typo"`, "npm test", "git log --oneline", "gh pr view 3", "gh pr list"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
  // Expansions are everyday arguments; they matter only in a gh command whose subcommand is not fixed.
  for (const command of ["ls *.ts *.md", "cp $SRC $DST", "echo $A $B", "git diff $BASE $HEAD", `for f in $FILES; do echo "$f"; done`, "gh pr view $(git branch --show-current)", "gh api repos/o/r/pulls/1", `gh repo clone pr "$DEST"`, "gh api repos/o/r/pulls/$N", "gh pr list $X", "gh issue list", "env FOO=1 npm test", "time npm test", "command -v gh", "nohup ls *.ts", "sudo -u gh npm test", "sudo -n gh issue list", `nice -n 5 echo "$HOME"`, "nice -n 5 make", `"$PYTHON" script.py`, "$EDITOR notes.md", `"$NODE" --test x`]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("a heredoc that does not mention a PR is not read as one, and a PR after a heredoc is refused", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const command of ["cat > notes <<'EOF'\nopen the pr later\nEOF", `git commit -m "$(cat <<'EOF'\nthen create it\nEOF\n)"`]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
  for (const command of ["cat > notes <<EOF\nit's done\nEOF\ngh pr create --title 'x'", "cat <<EOF | gh pr create --body-file -\nbody\nEOF"]) {
    assert.equal((await runHook(repo.root, command)).length, 1, command);
  }
});

test("refuses to open a PR from a branch with no review, and names the branch and the way forward", async (t) => {
  setEnv(t, { CLAUDE_PLUGIN_ROOT: "/plugin" });
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const [output] = await runHook(repo.root, "gh pr create --fill");
  const decision = JSON.parse(output).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /feature/);
  assert.match(decision.permissionDecisionReason, /\/coherence:review/);
});

test("the refusal never tells the agent it can pass its own review, and says skipping review is the owner's call", async (t) => {
  setEnv(t, { CLAUDE_PLUGIN_ROOT: "/plugin" });
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const reason = refusal(await runHook(repo.root, "gh pr create --fill"));
  assert.doesNotMatch(reason, /pr-gate pass/);
  assert.doesNotMatch(reason, /trivial/);
  assert.match(reason, /\/coherence:review/);
  assert.match(reason, /owner's decision/);
});

test("once the review is recorded the PR opens, for that branch only", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  assert.equal(await pass(repo.root), Exit.ok);
  assert.deepEqual(await runHook(repo.root, "gh pr create --fill"), []);

  git(repo.root, "checkout", "-q", "-b", "other");
  assert.equal((await runHook(repo.root, "gh pr create --fill")).length, 1);
});

test("a commit made after the review is refused, and passing again at the new HEAD lets the PR open", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  await pass(repo.root);
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "after the review");

  const [output] = await runHook(repo.root, "gh pr create --fill");
  assert.match(JSON.parse(output).hookSpecificOutput.permissionDecisionReason, /commits landed on branch feature after its coherence review/);

  await pass(repo.root);
  assert.deepEqual(await runHook(repo.root, "gh pr create --fill"), []);
});

test("a branch-wide mark from an earlier version counts as not reviewed", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  git(repo.root, "config", "branch.feature.coherence-reviewed", "true");

  const [output] = await runHook(repo.root, "gh pr create --fill");
  assert.match(JSON.parse(output).hookSpecificOutput.permissionDecisionReason, /has not had a coherence review/);
});

/** A feature branch two commits past main, so main and HEAD~1 are different bases. */
async function twoCommitFeature() {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "first");
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "second");
  return repo;
}

test("a review against a base lets the PR open when it names the local branch at that base, in any of gh's spellings", async () => {
  const repo = await twoCommitFeature();
  assert.equal(await pass(repo.root, "--base", "main"), Exit.ok);
  for (const command of ["gh pr create --base main --fill", "gh pr create -B main --fill", "gh pr create --base=main --fill", "gh pr create -Bmain --fill"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("the PR's base is read as a branch, as gh reads it, so a tag of the same name at the reviewed base does not count", async () => {
  const repo = await twoCommitFeature();
  const first = git(repo.root, "rev-parse", "HEAD~1");
  assert.equal(await pass(repo.root, "--base", first), Exit.ok);
  git(repo.root, "-c", "tag.gpgSign=false", "tag", "main", first);
  assert.equal(git(repo.root, "rev-parse", "main"), first);
  assert.match(refusal(await runHook(repo.root, "gh pr create --base main --fill")), /but the PR's base main is [0-9a-f]{8}, so the PR holds changes the review never read/);
});

test("a PR base with no local branch, or that is not a plain branch name, is refused, even when it names the reviewed commit", async () => {
  const repo = await twoCommitFeature();
  assert.equal(await pass(repo.root, "--base", "main"), Exit.ok);
  const main = git(repo.root, "rev-parse", "main");
  for (const base of ["nosuch", main, "refs/heads/main"]) {
    assert.match(refusal(await runHook(repo.root, `gh pr create --base ${base} --fill`)), new RegExp(`the PR's base ${base} has no local branch here.*Fetch or create the local branch`), base);
  }
  assert.match(refusal(await runHook(repo.root, "gh pr create --base main:x --fill")), /the PR's base main:x is not a plain branch name/);
});

test("a PR to a base other than the reviewed one is refused, and says how to fix it", async () => {
  const repo = await twoCommitFeature();
  assert.equal(await pass(repo.root, "--base", git(repo.root, "rev-parse", "HEAD~1")), Exit.ok);
  const reason = refusal(await runHook(repo.root, "gh pr create --base main --fill"));
  assert.match(reason, /was reviewed against [0-9a-f]{8}, but the PR's base main is [0-9a-f]{8}/);
  assert.match(reason, /\/coherence:review <base>.*--base/);
});

test("a PR that names no base, or names it twice, is refused when the review recorded one", async () => {
  const repo = await twoCommitFeature();
  assert.equal(await pass(repo.root, "--base", "main"), Exit.ok);
  assert.match(refusal(await runHook(repo.root, "gh pr create --fill")), /the PR does not name its base.*--base/);
  assert.match(refusal(await runHook(repo.root, "gh pr create --base main -B main --fill")), /base is named more than once/);
});

test("a review of the whole repo records the base as all, so a PR to any base, or none, opens", async () => {
  const repo = await twoCommitFeature();
  assert.equal(await pass(repo.root), Exit.ok);
  assert.equal(recorded(repo.root, "coherence-reviewed-base"), "all");
  for (const command of ["gh pr create --fill", "gh pr create --base main --fill", "gh pr create --base nosuch --fill"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("an approval with no recorded base, as earlier versions left it, or with a base that is not a commit, is refused", async () => {
  const repo = await twoCommitFeature();
  const head = git(repo.root, "rev-parse", "HEAD");
  for (const base of [undefined, "", "main", "ALL", head.slice(0, 12)]) {
    assert.equal(await pass(repo.root, "--base", "main"), Exit.ok);
    git(repo.root, "config", "--unset-all", "branch.feature.coherence-reviewed-base");
    if (base !== undefined) git(repo.root, "config", "branch.feature.coherence-reviewed-base", base);
    assert.equal(recorded(repo.root, "coherence-reviewed"), head, String(base));
    for (const command of ["gh pr create --fill", "gh pr create --base main --fill"]) {
      assert.match(refusal(await runHook(repo.root, command)), /records no base it was reviewed against\. Run \/coherence:review <base> again/, `${base} ${command}`);
    }
  }
});

function refusal(printed: string[]): string {
  assert.equal(printed.length, 1);
  const decision = JSON.parse(printed[0]).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  return decision.permissionDecisionReason;
}

async function runRawHook(cwd: string, stdin: string) {
  const invocation = fakeInvocation(cwd, [], stdin);
  assert.equal(await gate().execute(invocation), Exit.ok);
  return invocation.printed;
}

test("a PR opened outside a git repository is refused, since there is no commit to check", async () => {
  const folder = tempFolder();
  assert.match(refusal(await runHook(folder, "gh pr create --fill")), /could not check it: not a git repository/);
});

test("a PR opened on a detached HEAD is refused and asks for a branch", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "--detach");
  assert.match(refusal(await runHook(repo.root, "gh pr create --fill")), /HEAD is detached.*--head/);
});

test("hook input that is not JSON, or names no command, is always refused as unreadable", async () => {
  const folder = tempFolder();
  for (const stdin of [
    "{not json gh pr create",
    "{not json ls -la",
    "",
    "null",
    "42",
    JSON.stringify({ cwd: folder, tool_input: {} }),
    JSON.stringify({ cwd: folder, tool_input: { cmd: "gh pr create" } }),
    JSON.stringify({ cwd: folder, tool_input: { command: ["gh", "pr", "create"] } }),
  ]) {
    assert.equal(
      refusal(await runRawHook(folder, stdin)),
      "coherence pr-gate could not read the hook input, so it cannot tell whether this command opens a PR. " +
        "Claude Code's hook format may have changed: update or disable the coherence plugin.",
      stdin,
    );
  }
});

test("a hook folder that is not a non-empty string is ignored, and the PR is judged from the working folder", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const cwd of [42, "", null, ["/"]]) {
    const stdin = JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command: "gh pr create --fill" } });
    assert.match(refusal(await runRawHook(repo.root, stdin)), /branch feature has not had a coherence review/, String(cwd));
  }
});

test("an unknown verb prints the usage and exits 2, and pass needs a branch", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  const unknown = fakeInvocation(repo.root, ["maybe"]);
  assert.equal(await gate().execute(unknown), Exit.usage);
  assert.match(unknown.errors[0], /^usage: coherence pr-gate/);

  git(repo.root, "checkout", "-q", "--detach");
  const head = git(repo.root, "rev-parse", "HEAD");
  const detached = await passWith(repo.root, ["--branch", "main", "--verdict", "merge", "--head", head]);
  assert.equal(detached.code, Exit.findings);
  assert.match(detached.error, /^coherence pr-gate pass refused: a detached HEAD is checked out, not the reviewed main/);
});

test("pass with a --base that is not a commit is refused with a reason, as every other refusal is, not thrown", async () => {
  const repo = await twoCommitFeature();
  const refused = await passWith(repo.root, [...mergeOfHead(repo.root), "--base", "nosuchbranch"]);
  assert.equal(refused.code, Exit.usage);
  assert.match(refused.error, /^coherence pr-gate pass refused: nosuchbranch is not a commit/);
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass with a --base that git cannot read fails as a git failure, not as a bad ref", async () => {
  const repo = await twoCommitFeature();
  // A ref whose object is corrupt makes git itself fail, where a missing ref only fails to resolve.
  const id = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: "x" }).toString().trim();
  const object = join(repo.root, ".git", "objects", id.slice(0, 2), id.slice(2));
  chmodSync(object, 0o644);
  writeFileSync(object, "garbage");
  writeFileSync(join(repo.root, ".git", "refs", "heads", "broken"), `${id}\n`);
  const refused = await passWith(repo.root, [...mergeOfHead(repo.root), "--base", "broken"]);
  assert.equal(refused.code, Exit.failed);
  assert.match(refused.error, /^coherence pr-gate pass refused: git failed while resolving --base broken: git rev-parse failed/);
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass refuses without a branch, a verdict or a head, or with a branch name that is not plainly a name", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const head = git(repo.root, "rev-parse", "HEAD");
  const cases: [string[], RegExp][] = [
    [["--verdict", "merge", "--head", head], /refused: it needs --branch/],
    [["--branch=-c", "--verdict", "merge", "--head", head], /--branch is not a usable branch name: -c/],
    [["--branch", "a;b", "--verdict", "merge", "--head", head], /--branch is not a usable branch name: a;b/],
    [["--branch", "feature"], /refused: it needs --verdict and --head/],
    [["--branch", "feature", "--head", head], /refused: it needs --verdict and --head/],
    [["--branch", "feature", "--verdict", "merge"], /refused: it needs --verdict and --head/],
  ];
  for (const [args, reason] of cases) {
    const refused = await passWith(repo.root, args);
    assert.equal(refused.code, Exit.usage, args.join(" "));
    assert.match(refused.error, reason, args.join(" "));
  }
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("a fix first verdict revokes the reviewed branch, even after a switch to another branch or a detached HEAD", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "other");
  git(repo.root, "checkout", "-q", "-b", "feature");
  const head = git(repo.root, "rev-parse", "HEAD");
  for (const leave of [["checkout", "-q", "other"], ["checkout", "-q", "--detach"]]) {
    git(repo.root, "checkout", "-q", "feature");
    approve(repo.root);
    git(repo.root, "config", "branch.other.coherence-reviewed", head);
    git(repo.root, ...leave);
    const refused = await passWith(repo.root, ["--branch", "feature", "--verdict", "fix first", "--head", head]);
    assert.equal(refused.code, Exit.findings, leave.join(" "));
    assert.equal(recorded(repo.root, "coherence-reviewed"), undefined, leave.join(" "));
    assert.equal(recorded(repo.root, "coherence-reviewed", "other"), head, leave.join(" "));
  }
});

test("a merge verdict is recorded only while the reviewed branch is checked out", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const head = git(repo.root, "rev-parse", "HEAD");
  git(repo.root, "checkout", "-q", "-b", "other");
  const refused = await passWith(repo.root, ["--branch", "feature", "--verdict", "merge", "--head", head]);
  assert.equal(refused.code, Exit.findings);
  assert.match(refused.error, /branch other is checked out, not the reviewed feature/);
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
  assert.equal(recorded(repo.root, "coherence-reviewed", "other"), undefined);
});

test("pass refuses a base that is the reviewed commit itself", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const base of ["HEAD", "main", git(repo.root, "rev-parse", "HEAD")]) {
    const refused = await passWith(repo.root, [...mergeOfHead(repo.root), "--base", base]);
    assert.equal(refused.code, Exit.usage, base);
    assert.match(refused.error, /--base is the reviewed commit itself/, base);
  }
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("a fix first or rework verdict revokes an earlier approval of the same commit, and the PR is refused again", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "work");
  const head = git(repo.root, "rev-parse", "HEAD");
  for (const verdict of ["fix first", "rework", "Merge"]) {
    assert.equal(await pass(repo.root, "--base", "main"), Exit.ok, verdict);
    const refused = await passWith(repo.root, ["--branch", "feature", "--verdict", verdict, "--head", head]);
    assert.equal(refused.code, Exit.findings, verdict);
    assert.match(refused.error, new RegExp(`the verdict was "${verdict}", so feature is left with no recorded review`), verdict);
    assert.equal(recorded(repo.root, "coherence-reviewed"), undefined, verdict);
    assert.equal(recorded(repo.root, "coherence-reviewed-base"), undefined, verdict);
    assert.equal((await runHook(repo.root, "gh pr create --fill")).length, 1, verdict);
  }
});

/** Plants an approval of HEAD, as an earlier merge review would have left it. */
function approve(cwd: string): void {
  git(cwd, "config", "branch.feature.coherence-reviewed", git(cwd, "rev-parse", "HEAD"));
}

test("pass refuses a head that is not the current HEAD", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const reviewed = git(repo.root, "rev-parse", "HEAD");
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "after the review");
  const refused = await passWith(repo.root, ["--branch", "feature", "--verdict", "merge", "--head", reviewed]);
  assert.equal(refused.code, Exit.findings);
  assert.match(refused.error, new RegExp(`HEAD is now ${git(repo.root, "rev-parse", "HEAD")}, not the reviewed ${reviewed}`));
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass refuses a commit ID that is not 40 or 64 characters, even a short one that names HEAD", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const head = git(repo.root, "rev-parse", "HEAD");
  for (const id of [git(repo.root, "rev-parse", "--short", "HEAD"), `${head}a`, `${head}${"a".repeat(23)}`]) {
    const refused = await passWith(repo.root, ["--branch", "feature", "--verdict", "merge", "--head", id]);
    assert.equal(refused.code, Exit.usage, id);
    assert.match(refused.error, /--head must be a full commit ID/, id);
  }
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass refuses while the tree has uncommitted changes or untracked files, and revokes the earlier approval", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const dirty: [string, () => void][] = [
    ["unstaged", () => writeFiles(repo.root, { "a.ts": "changed\n" })],
    ["staged", () => git(repo.root, "add", "a.ts")],
    ["untracked", () => writeFiles(repo.root, { "notes.ts": "scratch\n" })],
  ];
  for (const [label, makeDirty] of dirty) {
    if (label === "untracked") git(repo.root, "reset", "-q", "--hard");
    makeDirty();
    approve(repo.root);
    const refused = await passWith(repo.root, ["--branch", "feature", "--verdict", "merge", "--head", git(repo.root, "rev-parse", "HEAD")]);
    assert.equal(refused.code, Exit.findings, label);
    assert.match(refused.error, /the working tree has uncommitted changes or untracked files/, label);
    assert.equal(recorded(repo.root, "coherence-reviewed"), undefined, label);
  }
});

test("ignored and excluded files do not make the tree dirty", async () => {
  const repo = await tempRepo({ "a.ts": "x\n", ".gitignore": "build/\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  writeFiles(repo.root, { ".git/info/exclude": ".claude/\n", ".claude/worktrees/agent/a.ts": "y\n", "build/out.js": "z\n" });
  assert.equal(await pass(repo.root), Exit.ok);
});

test("pass re-runs the checks and refuses when they find something, over the base it is given or the whole repo", async () => {
  const repo = await tempRepo({ "src/a/a.ts": CYCLE["src/a/a.ts"], "src/a/b.ts": "export const b = 1;\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  writeFiles(repo.root, { "src/a/b.ts": CYCLE["src/a/b.ts"] });
  git(repo.root, "commit", "-q", "-am", "close the cycle");
  const main = git(repo.root, "rev-parse", "main");
  for (const extra of [["--base", main], []]) {
    approve(repo.root);
    const refused = await passWith(repo.root, ["--branch", "feature", "--verdict", "merge", "--head", git(repo.root, "rev-parse", "HEAD"), ...extra]);
    assert.equal(refused.code, Exit.findings, extra.join(" "));
    assert.match(refused.error, /refused: coherence check reports findings, listed above/, extra.join(" "));
    assert.equal(recorded(repo.root, "coherence-reviewed"), undefined, extra.join(" "));
  }
});

test("pass with a base answers only for what the branch changed, as check --base does", async () => {
  const repo = await tempRepo(CYCLE);
  git(repo.root, "checkout", "-q", "-b", "feature");
  writeFiles(repo.root, { "src/b/new.ts": "export const fresh = 1;\n" });
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "unrelated work");
  assert.equal(await pass(repo.root, "--base", "main"), Exit.ok);
});

test("pass records the head and the base it was given, and a later pass without a base replaces it with the whole repo", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  const main = git(repo.root, "rev-parse", "main");
  git(repo.root, "checkout", "-q", "-b", "feature");
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "work");
  const head = git(repo.root, "rev-parse", "HEAD");

  assert.equal(await pass(repo.root, "--base", "main"), Exit.ok);
  assert.equal(recorded(repo.root, "coherence-reviewed"), head);
  assert.equal(recorded(repo.root, "coherence-reviewed-base"), main);

  assert.equal(await pass(repo.root), Exit.ok);
  assert.equal(recorded(repo.root, "coherence-reviewed"), head);
  assert.equal(recorded(repo.root, "coherence-reviewed-base"), "all");
});

test("a PR for a named branch is judged by that branch, whichever branch this folder is on", async () => {
  const repo = await reviewedIntegrationBranch();
  git(repo.root, "checkout", "-q", "main");
  for (const command of ["gh pr create --head integration --fill", "gh pr create --head=integration --fill", "gh pr create -H integration --fill"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }

  git(repo.root, "branch", "unreviewed");
  const [output] = await runHook(repo.root, "gh pr create --head unreviewed --fill");
  assert.match(JSON.parse(output).hookSpecificOutput.permissionDecisionReason, /branch unreviewed has not had a coherence review/);
});

test("a PR for a named branch is refused when that branch moved after its review", async () => {
  const repo = await reviewedIntegrationBranch();
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "after the review");
  git(repo.root, "checkout", "-q", "main");

  const [output] = await runHook(repo.root, "gh pr create --head integration --fill");
  assert.match(JSON.parse(output).hookSpecificOutput.permissionDecisionReason, /commits landed on branch integration after its coherence review/);
});

async function reviewedRepo() {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  await pass(repo.root);
  return repo;
}

const ONE_COMMAND = /could not check it: the line is not exactly one gh pr create command with fixed words/;

test("on a reviewed branch, a PR opened as one plain gh pr create command opens", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create --fill", `gh pr create --title 'a "b"' --body "c \\"d\\" e" -a @me --attach f.png --base main`, "  gh pr create --fill\n"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("Claude Code's PR form, a body from a quoted heredoc, reaches the review check, and the body is not read as commands", async () => {
  const standard = `gh pr create --title "t" --body "$(cat <<'EOF'\n## Summary\n- a > b, $(x) and \`y\`\nRan git commit -m x && cd ../other first.\n\nEOF\n)"`;
  const doubleQuoted = `gh pr create -b "$(cat <<"END"\nx; git commit\nEND\n)" --fill`;
  const unreviewed = await tempRepo({ "a.ts": "x\n" });
  git(unreviewed.root, "checkout", "-q", "-b", "feature");
  const repo = await reviewedRepo();
  for (const command of [standard, doubleQuoted]) {
    assert.match(refusal(await runHook(unreviewed.root, command)), /branch feature has not had a coherence review/, command);
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("a substitution that is not exactly a cat of a quoted heredoc, given to --body, is refused", async () => {
  const repo = await reviewedRepo();
  for (const [command, reason] of [
    [`gh pr create --body "$(cat <<EOF\nx\nEOF\n)"`, ONE_COMMAND],
    [`gh pr create --body "$(cat <<'EOF'\nx\nEOF\ngit commit -m y\nEOF\n)"`, ONE_COMMAND],
    [`gh pr create --body "$(cat <<'EOF' ; git commit\nx\nEOF\n)"`, ONE_COMMAND],
    [`gh pr create --body "$(cat <<'EOF'\nx\nEOF\n)"x`, ONE_COMMAND],
    [`gh pr create --title "$(cat <<'EOF'\nt\nEOF\n)"`, /only --body may be a substitution/],
    [`gh pr create "$(cat <<'EOF'\n-Hunreviewed\nEOF\n)"`, /cannot read a substitution as an option/],
  ] as const) {
    assert.match(refusal(await runHook(repo.root, command)), reason, command);
  }
});

test("each way Dissent found to change gh's words after the gate reads them is refused", async () => {
  const repo = await reviewedRepo();
  for (const command of [
    `gh pr create "$(echo -Hunreviewed)"`,
    `gh pr create "$(printf -- --head=unreviewed)"`,
    "gh pr create ${U:--Hunreviewed}",
    "gh pr create --title $ARGS",
    "printf -v PATH x; gh pr create",
    "/usr/bin/g[h] pr create --repo o/r",
    "gh --hostname pr pr create --repo o/r",
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), ONE_COMMAND, command);
  }
});

test("anything but one plain gh pr create command is refused, even on a reviewed branch", async () => {
  const repo = await reviewedRepo();
  for (const command of [
    "git commit -m x && gh pr create --fill",
    "git push && gh pr create",
    "git -C ../x status; gh pr create",
    "gh pr checkout 3 && gh pr create",
    "cd ../other && gh pr create",
    "( gh pr create --fill )",
    "cat <<'EOF' | gh pr create --body-file -\nb\nEOF",
    "echo x > .git/HEAD; gh pr create",
    "gh pr create --fill 2>/dev/null",
    "gh pr create --fill\ngit commit -m x",
    "gh pr create --fill # note",
    "env -C .. gh pr create",
    "GIT_DIR=../x/.git gh pr create",
    "GH_TOKEN=abc gh pr create",
    "export GH_REPO=o/r; gh pr create",
    "cat() (echo); gh pr create",
    "./gh pr create --fill",
    "/usr/bin/gh pr create --fill",
    "gh -R o/r pr create",
    "gh pr -R o/r create",
    "$(echo gh) pr create --fill",
    "`echo gh` pr create --fill",
    "gh pr create --title x*",
    "gh pr create --title {a,b}",
    "gh pr create --title ~",
    `gh pr create --title "$HOME"`,
    `gh pr create --title "\`id\`"`,
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), ONE_COMMAND, command);
  }
});

for (const name of ["GH_REPO", "GH_HOST"]) {
  test(`a PR is refused while ${name} is set in the hook's environment, since gh would follow it`, async (t) => {
    const repo = await reviewedRepo();
    setEnv(t, { [name]: "example.com/o/r" });
    assert.match(refusal(await runHook(repo.root, "gh pr create --fill")), new RegExp(`${name} is set in the environment`));
  });
}

test("a PR is refused while gh repo set-default stores a repository other than origin's, since gh would follow it", async () => {
  // gh repo set-default writes remote.<name>.gh-resolved; the value is `base` or an owner/repo, and only origin's `base` is this folder's repository.
  const withDefault = async (remote: string, value: string) => {
    const repo = await reviewedRepo();
    git(repo.root, "config", `remote.${remote}.gh-resolved`, value);
    return runHook(repo.root, "gh pr create --fill");
  };
  assert.deepEqual(await withDefault("origin", "base"), []);
  for (const [remote, value] of [["upstream", "base"], ["origin", "o/r"]]) {
    assert.match(refusal(await withDefault(remote, value)), new RegExp(`remote\\.${remote}\\.gh-resolved is ${value}`), remote);
  }
});

test("a PR pointed at another repository is refused", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create -R o/r", "gh pr create -Ro/r", "gh pr create -dR o/r", "gh pr create --repo o/r", "gh pr create --repo=o/r"]) {
    assert.match(refusal(await runHook(repo.root, command)), /--repo points gh at a repository the gate did not check/, command);
  }
});

test("a PR to the reviewed base in another repository is refused, since the base is resolved only in this one", async () => {
  const repo = await twoCommitFeature();
  assert.equal(await pass(repo.root, "--base", "main"), Exit.ok);
  for (const command of ["gh pr create --repo other/project --base main --fill", "gh pr create -B main -R other/project --fill"]) {
    assert.match(refusal(await runHook(repo.root, command)), /--repo points gh at a repository the gate did not check/, command);
  }
});

test("a word read as another option's value is not a head, even when it looks like one", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create --title -Hnope --fill", "gh pr create -t -Hnope", "gh pr create -tHnope", "gh pr create --body=x -b -Hnope"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("a word coherence cannot read as an option is refused, since what follows it could be its value or a head", async () => {
  const repo = await reviewedRepo();
  for (const [command, unknown] of [
    ["gh pr create --frobnicate -Hnope", "--frobnicate"],
    ["gh pr create -zHnope", "-zHnope"],
    ["gh pr create stray --fill", "stray"],
    ["gh pr create -- --fill", "--"],
    ["gh pr create - --fill", "-"],
    ["gh pr create --recover state.json", "--recover"],
    ["gh pr create --recover=state.json", "--recover=state.json"],
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), new RegExp(`cannot read ${unknown} as an option of gh pr create`), command);
  }
});

test("a head attached to -H is read the way gh reads it", async () => {
  const repo = await reviewedIntegrationBranch();
  git(repo.root, "checkout", "-q", "main");
  git(repo.root, "branch", "unreviewed");
  for (const command of ["gh pr create -Hintegration --fill", "gh pr create -H=integration --fill", "gh pr create -fHintegration", "gh pr create -dH integration"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
  for (const command of ["gh pr create -Hunreviewed", "gh pr create -dH unreviewed"]) {
    assert.match(refusal(await runHook(repo.root, command)), /branch unreviewed has not had a coherence review/, command);
  }
});

test("a head named more than once is refused as ambiguous", async () => {
  const repo = await reviewedIntegrationBranch();
  git(repo.root, "branch", "unreviewed");
  for (const command of ["gh pr create --head integration --head unreviewed", "gh pr create -H integration --head=unreviewed", "gh pr create -dHintegration -H unreviewed"]) {
    assert.match(refusal(await runHook(repo.root, command)), /head is named more than once/, command);
  }
});

test("hook input that cannot be read from stdin at all is refused as unreadable", async () => {
  const invocation = fakeInvocation(tempFolder());
  invocation.readStdin = async () => {
    throw new Error("EPIPE");
  };
  assert.equal(await gate().execute(invocation), Exit.ok);
  assert.match(refusal(invocation.printed), /^coherence pr-gate could not read the hook input/);
});

test("a hook that cannot decide by its deadline refuses, and a late decision prints no second answer", async (t) => {
  t.after(resumeRunning);
  const repo = await tempRepo({ "a.ts": "x\n" });
  const invocation = fakeInvocation(repo.root);
  const stdin = JSON.stringify({ cwd: repo.root, tool_name: "Bash", tool_input: { command: "gh pr create --fill" } });
  // Arrives after the deadline, and would be refused as unreviewed if it were still read.
  invocation.readStdin = () => new Promise((resolve) => setTimeout(() => resolve(stdin), 400));
  assert.equal(await new PrGateCommand(new CheckCommand(), 100).execute(invocation), Exit.ok);
  assert.match(refusal(invocation.printed), /could not check it: deciding took longer than 0.1 seconds/);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(invocation.printed.length, 1, invocation.printed.join("\n"));
});

test("a hook stuck on a hung git refuses by its deadline and kills that git, rather than leave it running", async (t) => {
  t.after(resumeRunning);
  const repo = await tempRepo({ "a.ts": "x\n" });
  const bin = tempFolder();
  const pidFile = join(tempFolder(), "git.pid");
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho $$ > '${pidFile}'\nexec /bin/sleep 30\n`);
  chmodSync(join(bin, "git"), 0o755);
  setEnv(t, { PATH: bin });
  const invocation = fakeInvocation(repo.root, [], JSON.stringify({ cwd: repo.root, tool_name: "Bash", tool_input: { command: "gh pr create --fill" } }));
  assert.equal(await new PrGateCommand(new CheckCommand(), 300).execute(invocation), Exit.ok);
  assert.match(refusal(invocation.printed), /deciding took longer than 0.3 seconds/);
  const pid = Number(readFileSync(pidFile, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, `git ${pid} is still running`);
});

test("the hook's deadline leaves at least 10 seconds of the timeout hooks/hooks.json gives it", () => {
  const hooks = JSON.parse(readFileSync(join(import.meta.dirname, "../../hooks/hooks.json"), "utf8"));
  const timeout = hooks.hooks.PreToolUse[0].hooks[0].timeout;
  assert.ok(HOOK_DEADLINE_MS + 10_000 <= timeout * 1000, `deadline ${HOOK_DEADLINE_MS} ms, hook timeout ${timeout} s`);
});

test("a PR for a named branch that has no local commit here is refused, and says to check out or fetch it", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  for (const head of ["someone:their-branch", "not-fetched"]) {
    const reason = refusal(await runHook(repo.root, `gh pr create --head ${head} --fill`));
    assert.match(reason, new RegExp(`branch ${head} has no local commit here`), head);
    assert.match(reason, /Check out or fetch the branch/, head);
  }
});

/** A stand-in for the check command that does whatever `run` does: crash, fail, or change the repo while it runs. */
class FakeCheck extends BaseCommand {
  readonly name = "check";
  readonly usage = "";
  private readonly run: () => number;

  constructor(run: () => number) {
    super();
    this.run = run;
  }

  async execute(): Promise<number> {
    return this.run();
  }
}

async function passThrough(cwd: string, check: FakeCheck) {
  const invocation = fakeInvocation(cwd, ["pass", ...mergeOfHead(cwd)]);
  const code = await new PrGateCommand(check).execute(invocation);
  return { code, error: invocation.errors.join("\n") };
}

test("pass refuses with exit 3 when the checks could not run, and never calls that a finding", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const outcomes: [() => number, string][] = [
    [() => Exit.usage, "coherence check exited 2"],
    [() => Exit.failed, "coherence check exited 3"],
    [() => { throw new Error("madge failed: boom"); }, "madge failed: boom"],
  ];
  for (const [run, why] of outcomes) {
    approve(repo.root);
    const refused = await passThrough(repo.root, new FakeCheck(run));
    assert.equal(refused.code, Exit.failed, why);
    assert.equal(refused.error, `coherence pr-gate pass refused: checks could not run: ${why}.`);
    assert.equal(recorded(repo.root, "coherence-reviewed"), undefined, why);
  }
});

test("pass refuses when the branch, HEAD or tree changes while the checks run", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const changes: [string, () => void][] = [
    ["commit", () => git(repo.root, "commit", "-q", "--allow-empty", "-m", "during the checks")],
    ["edit", () => writeFiles(repo.root, { "a.ts": "edited during the checks\n" })],
    ["checkout", () => git(repo.root, "checkout", "-q", "-b", "elsewhere")],
  ];
  for (const [label, change] of changes) {
    git(repo.root, "checkout", "-q", "-f", "feature");
    const refused = await passThrough(repo.root, new FakeCheck(() => (change(), Exit.ok)));
    assert.equal(refused.code, Exit.findings, label);
    assert.match(refused.error, /the branch, HEAD or working tree changed while the checks ran/, label);
    assert.equal(recorded(repo.root, "coherence-reviewed"), undefined, label);
  }
});

/** Puts a `git` first on PATH that fails one kind of change to the reviewed base, and passes everything else to the real git. */
function failBaseChanges(t: TestContext, change: "unset" | "write"): void {
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const fail = 'echo "planted failure" >&2; exit 1';
  const unset = change === "unset" ? fail : ":";
  const write = change === "write" ? fail : ":";
  const bin = tempFolder();
  const shim = join(bin, "git");
  writeFileSync(
    shim,
    "#!/bin/sh\n" +
      'case " $* " in *" branch.feature.coherence-reviewed-base"*)\n' +
      `  case " $* " in *" --get "*) ;; *" --unset-all "*) ${unset};; *) ${write};; esac;;\n` +
      "esac\n" +
      `exec "${realGit}" "$@"\n`,
  );
  chmodSync(shim, 0o755);
  setEnv(t, { PATH: `${bin}:${process.env.PATH}` });
}

for (const change of ["unset", "write"] as const) {
  test(`when the old base cannot be ${change === "unset" ? "cleared" : "replaced"}, no approval is left, neither the old one nor the new one`, async (t) => {
    const repo = await tempRepo({ "a.ts": "x\n" });
    const main = git(repo.root, "rev-parse", "main");
    git(repo.root, "checkout", "-q", "-b", "feature");
    await markCommitReviewed(repo, "feature", main, main);
    git(repo.root, "commit", "-q", "--allow-empty", "-m", "work");

    failBaseChanges(t, change);
    await assert.rejects(markCommitReviewed(repo, "feature", git(repo.root, "rev-parse", "HEAD"), main), /git config failed: planted failure/);
    assert.equal(await reviewedCommit(repo, "feature"), undefined);
  });
}

test("a pass clears every old base value, not only a single one", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const value of ["one", "two"]) git(repo.root, "config", "--add", "branch.feature.coherence-reviewed-base", value);
  assert.equal(await pass(repo.root), Exit.ok);
  assert.equal(git(repo.root, "config", "--get-all", "branch.feature.coherence-reviewed-base"), "all");
});
