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

function refusal(printed: string[]): string {
  assert.equal(printed.length, 1);
  const decision = JSON.parse(printed[0]).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  return decision.permissionDecisionReason;
}

async function runRawHook(cwd: string, stdin: string) {
  const invocation = fakeInvocation(cwd, [], stdin);
  assert.equal(await new PrGateCommand().execute(invocation), Exit.ok);
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
  assert.equal(await new PrGateCommand().execute(unknown), Exit.usage);
  assert.match(unknown.errors[0], /^usage: coherence pr-gate/);

  git(repo.root, "checkout", "-q", "--detach");
  assert.equal(await pass(repo.root), Exit.usage);
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

async function reviewedRepo() {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "feature");
  await pass(repo.root);
  return repo;
}

test("on a reviewed branch, a PR opened on its own or after a command that leaves HEAD alone opens", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create --fill", "git push && gh pr create --fill", "git status; gh pr create", "GH_TOKEN=abc gh pr create"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("a commit on the same line as the PR is refused even on a reviewed branch, since the gate checks before it runs", async () => {
  const repo = await reviewedRepo();
  const reason = refusal(await runHook(repo.root, "git add -A && git commit -m x && git push && gh pr create --fill"));
  assert.match(reason, /runs git commit, which can move the branch/);
  assert.match(reason, /Run gh pr create on its own, from the repo's folder/);
});

test("any git command that can move HEAD on the same line as the PR is refused", async () => {
  const repo = await reviewedRepo();
  for (const sub of ["merge", "rebase", "reset", "pull", "cherry-pick", "am", "revert", "stash", "switch", "checkout", "restore", "worktree", "fetch"]) {
    assert.match(refusal(await runHook(repo.root, `git -C . ${sub} x; gh pr create`)), new RegExp(`runs git ${sub},`), sub);
  }
});

test("a folder change on the same line as the PR is refused, since gh would run somewhere the gate did not check", async () => {
  const repo = await reviewedRepo();
  for (const command of ["cd ../other && gh pr create", "pushd ../other; gh pr create", "popd && gh pr create", "(cd ../other && gh pr create)"]) {
    assert.match(refusal(await runHook(repo.root, command)), /runs (cd|pushd|popd), so gh may run in a folder the gate did not check/, command);
  }
});

test("a PR pointed at another repository is refused", async () => {
  const repo = await reviewedRepo();
  for (const command of [
    "gh pr create -R o/r",
    "gh -R o/r pr create",
    "gh pr create -Ro/r",
    "gh pr create --repo o/r",
    "gh pr create --repo=o/r",
    "GH_REPO=o/r gh pr create",
    "GH_HOST=example.com gh pr create",
    "env GH_REPO=o/r gh pr create",
    "export GH_REPO=o/r; gh pr create",
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), /points gh at a repository the gate did not check/, command);
  }
});

test("a head attached to -H is read the way gh reads it", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "integration");
  await pass(repo.root);
  git(repo.root, "checkout", "-q", "main");
  git(repo.root, "branch", "unreviewed");
  for (const command of ["gh pr create -Hintegration --fill", "gh pr create -H=integration --fill"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
  assert.match(refusal(await runHook(repo.root, "gh pr create -Hunreviewed")), /branch unreviewed has not had a coherence review/);
});

test("a head named more than once, or inside a group of short options, is refused as ambiguous", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "integration");
  await pass(repo.root);
  git(repo.root, "branch", "unreviewed");
  for (const command of ["gh pr create --head integration --head unreviewed", "gh pr create -H integration --head=unreviewed", "gh pr create -dH unreviewed"]) {
    assert.match(refusal(await runHook(repo.root, command)), /head is named more than once or inside a group of short options/, command);
  }
});

test("hook input that cannot be read from stdin at all is refused as unreadable", async () => {
  const invocation = fakeInvocation(tempFolder());
  invocation.readStdin = async () => {
    throw new Error("EPIPE");
  };
  assert.equal(await new PrGateCommand().execute(invocation), Exit.ok);
  assert.match(refusal(invocation.printed), /^coherence pr-gate could not read the hook input/);
});

test("a PR for a named branch that has no local commit here is refused, and says to check out or fetch it", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  for (const head of ["someone:their-branch", "not-fetched"]) {
    const reason = refusal(await runHook(repo.root, `gh pr create --head ${head} --fill`));
    assert.match(reason, new RegExp(`branch ${head} has no local commit here`), head);
    assert.match(reason, /Check out or fetch the branch/, head);
  }
});
