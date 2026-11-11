import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Exit } from "../src/lib/base-command.ts";
import { tempFolder } from "./helpers/sandbox.ts";

const WRAPPER = resolve(import.meta.dirname, "../bin/coherence");

/** Where `tool` lives on the PATH these tests run with. */
function found(tool: string): string {
  return execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
}

const BROKEN = "#!/bin/sh\nexit 1\n";

/**
 * A PATH holding only what the wrapper itself calls, plus `tools`: a real one by name, or a script standing in for a
 * broken one (as Apple's /usr/bin/git is inside a sandbox that blocks the developer tools).
 */
function pathWith(tools: Record<string, "real" | "broken">): string {
  const dir = tempFolder();
  for (const tool of ["dirname", "readlink", "grep"]) symlinkSync(found(tool), join(dir, tool));
  for (const [tool, kind] of Object.entries(tools)) {
    if (kind === "real") symlinkSync(tool === "node" ? process.execPath : found(tool), join(dir, tool));
    else {
      writeFileSync(join(dir, tool), BROKEN);
      chmodSync(join(dir, tool), 0o755);
    }
  }
  return dir;
}

function run(path: string, args: string[], input = "") {
  const result = spawnSync(WRAPPER, args, { env: { PATH: path, HOME: tempFolder() }, input, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function hook(path: string, command: string) {
  return run(path, ["pr-gate"], JSON.stringify({ cwd: "/", tool_name: "Bash", tool_input: { command } }));
}

const SETUPS = {
  "node is absent": { git: "real" },
  "node cannot run TypeScript": { node: "broken", git: "real" },
  "git does not run": { node: "real", git: "broken" },
  "git is absent": { node: "real" },
} as const;

for (const [setup, tools] of Object.entries(SETUPS)) {
  const missing = setup.startsWith("node") ? /node/ : /git/;

  test(`when ${setup}, the PR hook refuses any line that mentions gh and names what is missing`, () => {
    const path = pathWith(tools);
    for (const command of ["gh pr list", "cd x && gh pr view 3", "cat <<EOF\ngh pr merge\nEOF", "/opt/homebrew/bin/gh pr list"]) {
      const { code, out } = hook(path, command);
      assert.equal(code, Exit.ok, command);
      const answer = JSON.parse(out).hookSpecificOutput;
      assert.equal(answer.hookEventName, "PreToolUse");
      assert.equal(answer.permissionDecision, "deny", command);
      assert.match(answer.permissionDecisionReason, missing);
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
