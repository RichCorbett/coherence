import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Exit } from "../src/lib/base-command.ts";
import { tempFolder } from "./helpers/sandbox.ts";

const WRAPPER = resolve(import.meta.dirname, "../bin/coherence");

/** How long the tests let a probe run, instead of the wrapper's 5 seconds. */
const PROBE_SECONDS = 0.2;

/** Where `tool` lives on the PATH these tests run with. */
function found(tool: string): string {
  return execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
}

/** Stand-ins for a tool that is there but broken (as Apple's /usr/bin/git is inside a sandbox that blocks the developer tools), or hangs. */
const STUBS = { broken: "#!/bin/sh\nexit 1\n", fails: "#!/bin/sh\nexit 2\n", hangs: "#!/bin/sh\nexec /bin/sleep 10\n" };

type Kind = "real" | "absent" | keyof typeof STUBS;

/** A PATH holding what the wrapper itself calls, real unless `tools` says otherwise, plus node and git as `tools` says. */
function pathWith(tools: Record<string, Kind>): string {
  const dir = tempFolder();
  const all: Record<string, Kind> = { dirname: "real", readlink: "real", grep: "real", sleep: "real", ...tools };
  for (const [tool, kind] of Object.entries(all)) {
    if (kind === "absent") continue;
    if (kind === "real") symlinkSync(tool === "node" ? process.execPath : found(tool), join(dir, tool));
    else {
      writeFileSync(join(dir, tool), STUBS[kind]);
      chmodSync(join(dir, tool), 0o755);
    }
  }
  return dir;
}

function run(path: string, args: string[], input = "") {
  const env = { PATH: path, HOME: tempFolder(), COHERENCE_PROBE_SECONDS: String(PROBE_SECONDS) };
  const result = spawnSync(WRAPPER, args, { env, input, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function hook(path: string, command: string) {
  return run(path, ["pr-gate"], JSON.stringify({ cwd: "/", tool_name: "Bash", tool_input: { command } }));
}

function assertRefused(answer: { code: number | null; out: string }, missing: RegExp, command: string) {
  assert.equal(answer.code, Exit.ok, command);
  const output = JSON.parse(answer.out).hookSpecificOutput;
  assert.equal(output.hookEventName, "PreToolUse");
  assert.equal(output.permissionDecision, "deny", command);
  assert.match(output.permissionDecisionReason, missing);
}

const SETUPS: Record<string, { tools: Record<string, Kind>; missing: RegExp }> = {
  "node is absent": { tools: { node: "absent", git: "real" }, missing: /node is not on PATH/ },
  "node cannot run TypeScript": { tools: { node: "broken", git: "real" }, missing: /cannot run TypeScript/ },
  "node hangs": { tools: { node: "hangs", git: "real" }, missing: /node did not answer within/ },
  "git does not run": { tools: { node: "real", git: "broken" }, missing: /git does not run/ },
  "git is absent": { tools: { node: "real", git: "absent" }, missing: /git does not run/ },
  "git hangs": { tools: { node: "real", git: "hangs" }, missing: /git did not answer within/ },
};

for (const [setup, { tools, missing }] of Object.entries(SETUPS)) {
  test(`when ${setup}, the PR hook refuses any line that mentions gh, in any case, and names what is missing`, () => {
    const path = pathWith(tools);
    for (const command of ["gh pr list", "cd x && gh pr view 3", "cat <<EOF\ngh pr merge\nEOF", "/opt/homebrew/bin/gh pr list", "GH pr list", "Gh pr view"]) {
      assertRefused(hook(path, command), missing, command);
    }
  });

  test(`when ${setup}, the PR hook lets a line without gh through, silently`, () => {
    const path = pathWith(tools);
    for (const command of ["ls", "git log --oneline", "cat ghost.txt"]) {
      assert.deepEqual(hook(path, command), { code: Exit.ok, out: "", err: "" }, command);
    }
  });

  test(`when ${setup}, every other command prints one line naming what is missing and exits unavailable`, () => {
    const path = pathWith(tools);
    for (const args of [["check"], ["pr-gate", "pass", "--verdict", "merge"]]) {
      const { code, out, err } = run(path, args);
      assert.equal(code, Exit.unavailable, args.join(" "));
      assert.equal(out, "");
      assert.match(err, /^coherence: [^\n]+\n$/);
      assert.match(err, missing);
    }
  });
}

test("a hung probe is cut off after its limit, not left to run into the hook's 30-second timeout", () => {
  const started = Date.now();
  assertRefused(hook(pathWith({ node: "hangs", git: "real" }), "gh pr list"), /did not answer/, "gh pr list");
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

test("the probe limit can only be shortened: a longer or malformed override falls back to 5 seconds and keeps the hook's JSON valid", () => {
  const env = { PATH: pathWith({ node: "hangs", git: "real" }), HOME: tempFolder(), COHERENCE_PROBE_SECONDS: '60"}' };
  const input = JSON.stringify({ cwd: "/", tool_name: "Bash", tool_input: { command: "gh pr list" } });
  const started = Date.now();
  const result = spawnSync(WRAPPER, ["pr-gate"], { env, input, encoding: "utf8" });
  assertRefused({ code: result.status, out: result.stdout }, /node did not answer within 5 seconds/, "gh pr list");
  assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
});

for (const [grep, how] of [["absent", "is absent"], ["fails", "fails"]] as const) {
  test(`when node is absent and grep ${how}, the PR hook refuses every line, since it cannot tell which mention gh`, () => {
    const path = pathWith({ node: "absent", git: "real", grep });
    for (const command of ["ls", "gh pr list"]) assertRefused(hook(path, command), /node is not on PATH/, command);
  });
}

test("taste and rules, which never call git, run without it", () => {
  const path = pathWith({ node: "real", git: "absent" });
  for (const command of ["taste", "rules"]) {
    const { code, err } = run(path, [command]);
    assert.deepEqual({ code, err }, { code: Exit.ok, err: "" }, command);
  }
});

test("with node and git working, the wrapper starts the command and hands it the hook's input", () => {
  const path = pathWith({ node: "real", git: "real" });
  assert.deepEqual(hook(path, "gh pr list"), { code: Exit.ok, out: "", err: "" });
  // Only main.ts, reading the hook's JSON, can tell this line from the one above.
  const { code, out } = hook(path, "gh pr create --fill");
  assert.equal(code, Exit.ok);
  const answer = JSON.parse(out).hookSpecificOutput;
  assert.equal(answer.permissionDecision, "deny");
  assert.doesNotMatch(answer.permissionDecisionReason, /coherence cannot check/);
});
