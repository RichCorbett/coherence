import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { setupLoop } from "./helpers.ts";

const HOOK = "pretooluse-work-order.ts";
const bash = (cwd: string, command: string) => ({ session_id: "s1", cwd, tool_name: "Bash", tool_input: { command } });

function ready(t: Parameters<typeof setupLoop>[0]) {
  const loop = setupLoop(t);
  loop.writeOrder({});
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  const decision = (command: string, cwd = loop.workdir) => loop.run(HOOK, bash(cwd, command))?.hookSpecificOutput?.permissionDecision;
  return { loop, decision };
}

test("the guard refuses edits and Bash lines that touch the loop home, with or without a work order", (t) => {
  const loop = setupLoop(t);
  const edit = loop.run(HOOK, { cwd: loop.workdir, tool_name: "Write", tool_input: { file_path: join(loop.home, "work-order.json") } });
  assert.equal(edit?.hookSpecificOutput.permissionDecision, "deny");
  for (const command of [`cat > ${loop.home}/approval.json`, "rm ~/.config/coherence-loop/approval.json", "node loop/approve.ts"]) {
    assert.equal(loop.run(HOOK, bash(loop.workdir, command))?.hookSpecificOutput.permissionDecision, "deny", command);
  }
  assert.equal(loop.run(HOOK, { cwd: loop.workdir, tool_name: "Edit", tool_input: { file_path: "src/main.ts" } }), undefined);
});

test("with no approved work order nothing is allowed; the usual flow decides", (t) => {
  const loop = setupLoop(t);
  loop.writeOrder({}, false);
  loop.setStates({ 66: "open", 67: "open", 58: "open" });
  assert.equal(loop.run(HOOK, bash(loop.workdir, "git push origin main")), undefined);
});

test("the current item's merge, push and issue close are allowed", (t) => {
  const { decision } = ready(t);
  assert.equal(decision("git merge --no-ff -m 'Merge feat/66-guard: guard the baseline (#66)' feat/66-guard"), "allow");
  assert.equal(decision("git -c push.negotiate=true push -u origin main"), "allow");
  assert.equal(decision("gh issue close 66 -R RichCorbett/coherence --comment 'Shipped in 0.1.19'"), "allow");
});

test("a listed step with tests and reads in the same line is allowed", (t) => {
  const { loop, decision } = ready(t);
  assert.equal(decision(`cd ${loop.workdir} && git merge feat/66-guard && npm test && git push origin main`), "allow");
});

test("steps the item does not list, or that reach past it, fall through", (t) => {
  const { decision } = ready(t);
  assert.equal(decision("git merge feat/67-trust"), undefined, "another item's branch");
  assert.equal(decision("gh issue close 67"), undefined, "another item's issue");
  assert.equal(decision("git push --force origin main"), undefined, "force push");
  assert.equal(decision("git push origin main:release"), undefined, "another ref");
  assert.equal(decision("git push upstream main"), undefined, "another remote");
  assert.equal(decision("git merge feat/66-guard && rm -rf node_modules"), undefined, "an unlisted command rides along");
  assert.equal(decision("git merge feat/66-guard > /tmp/log"), undefined, "a redirect");
  assert.equal(decision("claude plugin install coherence@coherence"), undefined, "plugin install stays gated");
  assert.equal(decision("npm test"), undefined, "a routine command alone is left to the usual flow");
});

test("a merge is allowed only on the base branch, and a push only to Rich's fork", (t) => {
  const { loop, decision } = ready(t);
  loop.git("checkout", "-q", "-b", "feat/66-guard");
  assert.equal(decision("git merge feat/66-guard"), undefined);
  loop.git("checkout", "-q", "main");
  loop.git("remote", "set-url", "origin", "https://github.com/grreardon/coherence.git");
  assert.equal(decision("git push origin main"), undefined);
});

test("eval runs are allowed within the item's caps", (t) => {
  const { decision } = ready(t);
  const run = "claude plugin eval . --scaffold --runs 1 --trust-plugin --ablation none --no-publish";
  assert.equal(decision(run.replace("--runs 1", "--runs 3")), undefined, "too many runs");
  assert.equal(decision(run.replace(" --no-publish", "")), undefined, "publishing");
  assert.equal(decision(run), "allow");
  assert.equal(decision(run), "allow");
  assert.equal(decision(run), undefined, "evalCalls is 2");
});

test("after the current item closes, its steps no longer pass and the next item's do", (t) => {
  const { loop, decision } = ready(t);
  assert.equal(decision("gh issue close 66"), "allow");
  loop.setStates({ 66: "closed", 67: "open", 58: "open" });
  // The issue cache lasts a minute; dropping it stands in for that minute passing.
  rmSync(join(loop.home, "state", "issues.json"));
  assert.equal(decision("gh issue close 66"), undefined);
  assert.equal(decision("git merge feat/67-trust"), "allow");
});
