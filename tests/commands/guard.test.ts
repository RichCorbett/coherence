import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { PrGateCommand } from "../../src/commands/pr-gate.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { tempFolder } from "../helpers/sandbox.ts";
import { fakeInvocation } from "../helpers/temp-repo.ts";

async function runHook(command: string): Promise<string[]> {
  const cwd = tempFolder();
  const invocation = fakeInvocation(cwd, [], JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command } }));
  assert.equal(await new PrGateCommand(new CheckCommand()).execute(invocation), Exit.ok);
  return invocation.printed;
}

function refusal(printed: string[]): string {
  assert.equal(printed.length, 1);
  const decision = JSON.parse(printed[0]).hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  return decision.permissionDecisionReason;
}

test("a Bash line that saves the baseline is refused, however it is spelled or wrapped", async () => {
  for (const command of [
    "coherence check --save-baseline",
    '"${CLAUDE_PLUGIN_ROOT}/bin/coherence" check --save-baseline',
    "XDG_CONFIG_HOME=/tmp/x node src/main.ts check --SAVE-BASELINE",
    "cd repo && bin/coherence check --save-baseline; echo done",
  ]) {
    assert.match(refusal(await runHook(command)), /saving the baseline, which the owner runs in their own terminal/, command);
  }
});

test("a Bash line naming the owner's baseline folder is refused", async () => {
  for (const command of [
    "echo '{}' > ~/.config/coherence/baselines/abc.json",
    "rm -rf $HOME/.config/coherence/baselines",
    "cp mine.json /Users/me/.config/Coherence/Baselines/abc.json",
  ]) {
    assert.match(refusal(await runHook(command)), /the owner's baseline folder/, command);
  }
});

test("ordinary coherence commands and taste lines still run", async () => {
  for (const command of [
    "coherence check --base main",
    '"${CLAUDE_PLUGIN_ROOT}/bin/coherence" taste add "prefer plain names"',
    "coherence taste",
    "ls ~/.config/coherence",
    "ls ~/.claude/plugins/cache",
    "/Users/me/.claude/plugins/cache/coherence/coherence/0.1.5/bin/coherence check --base 'main'",
    "/Users/me/.claude/plugins/cache/coherence/coherence/0.1.5/bin/coherence review-input --base 'main'",
  ]) {
    assert.deepEqual(await runHook(command), [], command);
  }
});
