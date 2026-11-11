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
  const [output] = await runHook(repo.root, "gh pr create --fill");
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

test("on a reviewed branch, a PR opened as the only command on the line opens, even in a subshell, which runs in the same folder", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create --fill", "( gh pr create --fill )"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("a commit on the same line as the PR is refused even on a reviewed branch, since the gate checks before it runs", async () => {
  const repo = await reviewedRepo();
  const reason = refusal(await runHook(repo.root, "git commit -m x && gh pr create --fill"));
  assert.match(reason, /run gh pr create on its own, as a separate command from the repo's folder, and run git separately first/);
});

test("any other command on the same line as the PR is refused, and named, since the gate checks before it runs", async () => {
  const repo = await reviewedRepo();
  for (const [command, first] of [
    ["git push && gh pr create", "git"],
    ["git -C ../x status; gh pr create", "git"],
    ["gh pr checkout 3 && gh pr create", "gh"],
    ["cd ../other && gh pr create", "cd"],
    ["pushd ../other; gh pr create", "pushd"],
    ["(cd ../other && gh pr create)", "cd"],
    ["export GH_REPO=o/r; gh pr create", "export"],
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), new RegExp(`runs another command; .*run ${first} separately first`), command);
  }
});

test("a body filled by a heredoc through cat reaches the review check, and the heredoc text is not read as commands", async () => {
  const substitution = `gh pr create --title "t" --body "$(cat <<'EOF'\n## Summary\nRan git commit -m x && cd ../other first.\n\nEOF\n)"`;
  const piped = "cat <<'EOF' | gh pr create --body-file -\nthen git commit and cd ..\nEOF";
  const unreviewed = await tempRepo({ "a.ts": "x\n" });
  git(unreviewed.root, "checkout", "-q", "-b", "feature");
  const repo = await reviewedRepo();
  for (const command of [substitution, piped]) {
    assert.match(refusal(await runHook(unreviewed.root, command)), /branch feature has not had a coherence review/, command);
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("a print command that writes a file on the same line as the PR is refused", async () => {
  const repo = await reviewedRepo();
  for (const [command, first] of [
    ["echo x > .git/HEAD; gh pr create", "echo"],
    ["cat a >> b && gh pr create", "cat"],
    ["printf x 2>err; gh pr create", "printf"],
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), new RegExp(`runs another command; .*run ${first} separately first`), command);
  }
});

test("anything in front of gh, a wrapper or any assignment, is refused, since it can change where or how gh runs", async () => {
  const repo = await reviewedRepo();
  for (const [command, first] of [
    ["env -C .. gh pr create", "env"],
    ["env --chdir=.. gh pr create", "env"],
    ["command gh pr create", "command"],
    ["GIT_DIR=../x/.git gh pr create", "GIT_DIR=../x/.git"],
    ["GIT_WORK_TREE=../x gh pr create", "GIT_WORK_TREE=../x"],
    ["PATH=. gh pr create", "PATH=."],
    ["GH_REPO=o/r gh pr create", "GH_REPO=o/r"],
    ["GH_HOST=example.com gh pr create", "GH_HOST=example.com"],
    ["GH_TOKEN=abc gh pr create", "GH_TOKEN=abc"],
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), new RegExp(`${first} comes before gh, and can change where or how it runs`), command);
  }
  for (const command of ["export GIT_DIR=../x/.git; gh pr create", "GH_REPO=o/r; gh pr create"]) {
    assert.match(refusal(await runHook(repo.root, command)), /runs another command/, command);
  }
});

test("a PR pointed at another repository is refused", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create -R o/r", "gh -R o/r pr create", "gh pr create -Ro/r", "gh pr create -dR o/r", "gh pr create --repo o/r", "gh pr create --repo=o/r"]) {
    assert.match(refusal(await runHook(repo.root, command)), /--repo points gh at a repository the gate did not check/, command);
  }
});

test("a word read as another option's value is not a head, even when it looks like one", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create --title -Hnope --fill", "gh pr create -t -Hnope", "gh pr create -tHnope", "gh pr create --body=x -b -Hnope"]) {
    assert.deepEqual(await runHook(repo.root, command), [], command);
  }
});

test("an option coherence does not know is refused, since what follows it could be its value or a head", async () => {
  const repo = await reviewedRepo();
  for (const [command, unknown] of [
    ["gh pr create --frobnicate -Hnope", "--frobnicate"],
    ["gh pr create -zHnope", "-zHnope"],
  ]) {
    assert.match(refusal(await runHook(repo.root, command)), new RegExp(`does not know the option ${unknown},`), command);
  }
});

test("a function definition on the PR's line is refused, since it can shadow gh, cat, echo or printf", async () => {
  const repo = await reviewedRepo();
  for (const command of ["cat() (echo); cat <<'EOF' | gh pr create --body-file -\nb\nEOF", "gh () (echo) ; gh pr create"]) {
    assert.match(refusal(await runHook(repo.root, command)), /holds a function definition/, command);
  }
  assert.match(refusal(await runHook(repo.root, "function echo { :; }; gh pr create")), /runs another command; .*run function separately first/);
});

test("a substitution outside double quotes is refused, since its output becomes words gh reads", async () => {
  const repo = await reviewedRepo();
  for (const command of ["gh pr create $(echo --repo x)", "gh pr create `echo -R x`", "cat <<EOF | gh pr create --body-file -\n$(echo hi)\nEOF"]) {
    assert.match(refusal(await runHook(repo.root, command)), /substitution/, command);
  }
});

test("a head attached to -H is read the way gh reads it", async () => {
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "integration");
  await pass(repo.root);
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
  const repo = await tempRepo({ "a.ts": "x\n" });
  git(repo.root, "checkout", "-q", "-b", "integration");
  await pass(repo.root);
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
