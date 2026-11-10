import assert from "node:assert/strict";
import { test } from "node:test";
import { PrGateCommand } from "../../src/commands/pr-gate.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { setEnv, tempFolder } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

async function runHook(cwd: string, command: string) {
  const invocation = fakeInvocation(cwd, [], JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command } }));
  assert.equal(await new PrGateCommand().execute(invocation), Exit.ok);
  return invocation.printed;
}

function pass(cwd: string) {
  return new PrGateCommand().execute(fakeInvocation(cwd, ["pass"]));
}

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
  assert.match(decision.permissionDecisionReason, / \/plugin\/bin\/coherence pr-gate pass/);
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

test("stays out of the way outside a git repository and on a detached HEAD", async () => {
  assert.deepEqual(await runHook(tempFolder(), "gh pr create --fill"), []);
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "--detach");
  assert.deepEqual(await runHook(repo.root, "gh pr create --fill"), []);
});

test("an unknown verb prints the usage and exits 2, and pass needs a branch", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  const unknown = fakeInvocation(repo.root, ["maybe"]);
  assert.equal(await new PrGateCommand().execute(unknown), Exit.usage);
  assert.match(unknown.errors[0], /^usage: coherence pr-gate/);

  git(repo.root, "checkout", "-q", "--detach");
  assert.equal(await pass(repo.root), Exit.usage);
});
