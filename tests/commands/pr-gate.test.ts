import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { PrGateCommand } from "../../src/commands/pr-gate.ts";
import { Exit } from "../../src/lib/base-command.ts";
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

/** Records a merge verdict for the commit now at HEAD, as the review skill does. */
async function pass(cwd: string, ...extra: string[]) {
  return (await passWith(cwd, ["--verdict", "merge", "--head", git(cwd, "rev-parse", "HEAD"), ...extra])).code;
}

function recorded(cwd: string, key: string): string | undefined {
  try {
    return git(cwd, "config", "--get", `branch.feature.${key}`);
  } catch {
    return undefined;
  }
}

const CYCLE = {
  "src/a/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
  "src/a/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
};

test("lets every other shell command through without asking git anything", async () => {
  assert.deepEqual(await runHook(tempFolder(), "gh pr list"), []);
});

test("text that only mentions opening a PR is not refused", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const command of [`git commit -m "run gh pr create later"`, `echo 'gh pr create'`, `grep -rn "gh pr create" src`, `cat notes-about-gh pr create`]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
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

test("a heredoc body is not read as commands, and what follows it is", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const command of ["cat > notes <<'EOF'\ngh pr create\nEOF", `git commit -m "$(cat <<'EOF'\nthen gh pr create\nEOF\n)"`]) {
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
  const [output] = await runHook(repo.root, "git push && gh pr create --fill");
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
  const detached = await passWith(repo.root, ["--verdict", "merge", "--head", head]);
  assert.equal(detached.code, Exit.findings);
  assert.match(detached.error, /^coherence pr-gate pass refused: HEAD is detached/);
});

test("pass refuses without a verdict or a head, and records nothing", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const head = git(repo.root, "rev-parse", "HEAD");
  for (const args of [[], ["--head", head], ["--verdict", "merge"]]) {
    const refused = await passWith(repo.root, args);
    assert.equal(refused.code, Exit.usage, args.join(" "));
    assert.match(refused.error, /refused: it needs --verdict and --head/, args.join(" "));
  }
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass refuses a fix first or rework verdict, and the PR stays refused", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const head = git(repo.root, "rev-parse", "HEAD");
  for (const verdict of ["fix first", "rework", "Merge"]) {
    const refused = await passWith(repo.root, ["--verdict", verdict, "--head", head]);
    assert.equal(refused.code, Exit.findings, verdict);
    assert.match(refused.error, new RegExp(`the verdict was "${verdict}", and only a merge verdict is recorded`), verdict);
  }
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
  assert.equal((await runHook(repo.root, "gh pr create --fill")).length, 1);
});

test("pass refuses a head that is not the current HEAD", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const reviewed = git(repo.root, "rev-parse", "HEAD");
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "after the review");
  const refused = await passWith(repo.root, ["--verdict", "merge", "--head", reviewed]);
  assert.equal(refused.code, Exit.findings);
  assert.match(refused.error, new RegExp(`HEAD is now ${git(repo.root, "rev-parse", "HEAD")}, not the reviewed ${reviewed}`));
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass refuses a short commit ID, even one that names HEAD", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  const refused = await passWith(repo.root, ["--verdict", "merge", "--head", git(repo.root, "rev-parse", "--short", "HEAD")]);
  assert.equal(refused.code, Exit.usage);
  assert.match(refused.error, /--head must be a full commit ID/);
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass refuses while tracked files have uncommitted changes, staged or not, but not for an untracked file", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  writeFiles(repo.root, { "a.ts": "changed\n" });
  for (const stage of [false, true]) {
    if (stage) git(repo.root, "add", "a.ts");
    const refused = await passWith(repo.root, ["--verdict", "merge", "--head", git(repo.root, "rev-parse", "HEAD")]);
    assert.equal(refused.code, Exit.findings, `staged: ${stage}`);
    assert.match(refused.error, /tracked files have uncommitted changes/, `staged: ${stage}`);
  }
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);

  git(repo.root, "reset", "-q", "--hard");
  writeFiles(repo.root, { "notes.txt": "scratch\n" });
  assert.equal(await pass(repo.root), Exit.ok);
});

test("pass re-runs the checks and refuses when they find something, over the base it is given or the whole repo", async () => {
  const repo = await tempRepo({ "src/a/a.ts": CYCLE["src/a/a.ts"], "src/a/b.ts": "export const b = 1;\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  writeFiles(repo.root, { "src/a/b.ts": CYCLE["src/a/b.ts"] });
  git(repo.root, "commit", "-q", "-am", "close the cycle");
  const main = git(repo.root, "rev-parse", "main");
  for (const extra of [["--base", main], []]) {
    const refused = await passWith(repo.root, ["--verdict", "merge", "--head", git(repo.root, "rev-parse", "HEAD"), ...extra]);
    assert.equal(refused.code, Exit.findings, extra.join(" "));
    assert.match(refused.error, /refused: coherence check reports findings, listed above/, extra.join(" "));
  }
  assert.equal(recorded(repo.root, "coherence-reviewed"), undefined);
});

test("pass records the head and the base it was given, and a later pass without a base drops the old one", async () => {
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
  assert.equal(recorded(repo.root, "coherence-reviewed-base"), undefined);
});

test("a PR for a named branch is judged by that branch, whichever branch this folder is on", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "integration");
  await pass(repo.root);
  git(repo.root, "checkout", "-q", "main");
  for (const command of ["gh pr create --head integration --fill", "gh pr create --head=integration --fill", "gh pr create -H integration --fill"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }

  git(repo.root, "branch", "unreviewed");
  const [output] = await runHook(repo.root, "gh pr create --head unreviewed --fill");
  assert.match(JSON.parse(output).hookSpecificOutput.permissionDecisionReason, /branch unreviewed has not had a coherence review/);
});

test("a PR for a named branch is refused when that branch moved after its review", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "integration");
  await pass(repo.root);
  git(repo.root, "commit", "-q", "--allow-empty", "-m", "after the review");
  git(repo.root, "checkout", "-q", "main");

  const [output] = await runHook(repo.root, "gh pr create --head integration --fill");
  assert.match(JSON.parse(output).hookSpecificOutput.permissionDecisionReason, /commits landed on branch integration after its coherence review/);
});

test("a PR for a named branch that has no local commit here is refused, and says to check out or fetch it", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  for (const head of ["someone:their-branch", "not-fetched"]) {
    const reason = refusal(await runHook(repo.root, `gh pr create --head ${head} --fill`));
    assert.match(reason, new RegExp(`branch ${head} has no local commit here`), head);
    assert.match(reason, /Check out or fetch the branch/, head);
  }
});
