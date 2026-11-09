import assert from "node:assert/strict";
import { test } from "node:test";
import { GateCommand } from "../../src/commands/gate.ts";
import { fakeInvocation, tempRepo, writeFiles } from "../helpers/temp-repo.ts";
import { tempFolder } from "../helpers/env.ts";

function brief(spine: string, overrides: Record<string, string | null> = {}): string {
  const fields: Record<string, string | null> = {
    Idea: "one voice",
    Spine: spine,
    Slot: "add a command",
    Reuse: "BaseCommand",
    Done: "tests pass",
    ...overrides,
  };
  return Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `**${name}:** ${value}`)
    .join("\n");
}

async function runGate(cwd: string, subagentType: string, prompt: string) {
  const stdin = JSON.stringify({ cwd, tool_name: "Agent", tool_input: { subagent_type: subagentType, prompt } });
  const invocation = fakeInvocation(cwd, [], stdin);
  const code = await new GateCommand().execute(invocation);
  return { code, printed: invocation.printed };
}

function denial(printed: string[]): string {
  assert.equal(printed.length, 1);
  const output = JSON.parse(printed[0]).hookSpecificOutput;
  assert.equal(output.hookEventName, "PreToolUse");
  assert.equal(output.permissionDecision, "deny");
  return output.permissionDecisionReason;
}

test("lets a subagent that is not a coder through untouched", async () => {
  const repo = await tempRepo({});
  assert.deepEqual(await runGate(repo.root, "Explore", "look around"), { code: 0, printed: [] });
});

test("lets a complete brief through when every spine path is committed", async () => {
  const repo = await tempRepo({ "src/a.ts": "a\n", "src/b.ts": "b\n" });
  for (const type of ["coder", "coherence:coder"]) {
    assert.deepEqual(await runGate(repo.root, type, brief("- `src/a.ts`, src/b.ts")), { code: 0, printed: [] });
  }
});

test("accepts markdown headings and a spine split across lines", async () => {
  const repo = await tempRepo({ "src/a.ts": "a\n", "src/b.ts": "b\n" });
  const prompt = "## idea: x\n## Spine:\n* src/a.ts\n* src/b.ts\n## Slot: y\nReuse: z\nDONE: w";
  assert.deepEqual(await runGate(repo.root, "coder", prompt), { code: 0, printed: [] });
});

test("denies a brief with missing or empty fields, naming each one", async () => {
  const repo = await tempRepo({ "src/a.ts": "a\n" });
  const result = await runGate(repo.root, "coder", brief("src/a.ts", { Reuse: null, Done: "  " }));
  assert.equal(result.code, 0);
  const reason = denial(result.printed);
  assert.match(reason, /Reuse field is missing/);
  assert.match(reason, /Done field is missing/);
  assert.match(reason, /commit the spine first/);
});

test("denies a spine file that is not committed", async () => {
  const repo = await tempRepo({});
  writeFiles(repo.root, { "src/new.ts": "n\n" });
  assert.match(denial((await runGate(repo.root, "coder", brief("src/new.ts"))).printed), /src\/new\.ts is not committed/);
});

test("denies a spine file with local modifications", async () => {
  const repo = await tempRepo({ "src/a.ts": "a\n" });
  writeFiles(repo.root, { "src/a.ts": "changed\n" });
  assert.match(denial((await runGate(repo.root, "coder", brief("src/a.ts"))).printed), /src\/a\.ts is not committed/);
});

test("denies a spine path that does not exist or is outside any git repository", async () => {
  const repo = await tempRepo({});
  const outside = tempFolder();
  writeFiles(outside, { "loose.ts": "l\n" });
  const reason = denial((await runGate(repo.root, "coder", brief(`gone.ts ${outside}/loose.ts`))).printed);
  assert.match(reason, /gone\.ts does not exist/);
  assert.match(reason, /loose\.ts is not in a git repository/);
});

test("judges a spine in another repo by that repo, not by the session's cwd", async () => {
  const session = await tempRepo({});
  const target = await tempRepo({ "src/a.ts": "a\n" });
  const spine = `${target.root}/src/a.ts`;
  assert.deepEqual(await runGate(session.root, "coder", brief(spine)), { code: 0, printed: [] });

  writeFiles(target.root, { "src/a.ts": "changed\n" });
  assert.match(denial((await runGate(session.root, "coder", brief(spine))).printed), /is not committed/);
});
