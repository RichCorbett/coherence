import assert from "node:assert/strict";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DeadCodeCheck } from "../../src/checks/dead-code.ts";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { tempFolder, writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

// An entry point that uses one export of lib.ts, which also exports a value and a type that nothing imports.
const APP = {
  "package.json": JSON.stringify({ name: "app", main: "src/index.ts" }),
  "src/index.ts": 'import { used } from "./lib.ts";\nconsole.log(used);\n',
  "src/lib.ts": "export const used = 1;\nexport const unused = 2;\nexport type Unused = number;\n",
};

async function report(files: Record<string, string>): Promise<string[]> {
  const findings = await new DeadCodeCheck().run(await tempRepo(files));
  return findings.map((finding) => `${finding.path}:${finding.line ?? ""} ${finding.tier} ${finding.message}`).sort();
}

test("an export and a type that nothing imports are notes on their lines, and a used export is not reported", async () => {
  assert.deepEqual(await report(APP), [
    "src/lib.ts:2 note export unused is not imported anywhere; remove it or say why it is public",
    "src/lib.ts:3 note type Unused is not imported anywhere; remove it or say why it is public",
  ]);
});

test("a file no file imports is noted, and one under fixtures is not", async () => {
  const findings = await report({ ...APP, "src/orphan.ts": "console.log(1);\n", "tests/fixtures/orphan.ts": "export const f = 1;\n" });
  assert.deepEqual(
    findings.filter((line) => line.includes("orphan")),
    ["src/orphan.ts: note no file imports this one; remove it or make it an entry point"],
  );
});

test("a repo with no source files is not handed to fallow", async () => {
  assert.deepEqual(await report({ "notes.md": "hi\n" }), []);
});

test("an error answer from fallow fails the check with fallow's message", async () => {
  await assert.rejects(report({ ...APP, "package.json": '{ "name": ' }), { message: /^fallow failed: root package\.json .* is not valid JSON/ });
});

test("through check, dead code is a note and the branch stays clean", async () => {
  const repo = await tempRepo(APP);
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new CheckCommand().execute(invocation), Exit.ok);
  assert.ok(invocation.printed.includes("src/lib.ts:2 [dead-code] note: export unused is not imported anywhere; remove it or say why it is public"));
  assert.equal(invocation.printed.at(-1), "coherence check: clean (2 note(s))");
});

test("fallow never sees the repo: its fallow config, its .git and its symlinks reach nothing outside it", async () => {
  // A malformed outside file, so a fallow that follows the extends fails and names it; a canary in a well-formed one might pass unseen.
  const outside = tempFolder();
  writeFiles(outside, { "canary.json": '{ "entry": [canary', "secret.ts": "export const canary = 1;\n" });
  const repo = await tempRepo({ ...APP, ".fallowrc.json": JSON.stringify({ extends: [join(outside, "canary.json")] }) });
  symlinkSync(join(outside, "secret.ts"), repo.absolutePath("src/linked.ts"));
  symlinkSync(outside, repo.absolutePath("src/linked"));
  // Set last, since the test's own git calls do not turn fsmonitor off.
  const marker = join(outside, "fsmonitor-ran");
  git(repo.root, "config", "core.fsmonitor", `touch '${marker}'; false`);

  const outcome = await new DeadCodeCheck().run(repo).then(
    (findings) => JSON.stringify(findings),
    (error: Error) => error.message,
  );
  assert.equal(existsSync(marker), false);
  assert.doesNotMatch(outcome, /canary/i);
  assert.match(outcome, /export unused is not imported anywhere/);
});

test("the repo's fallow-ignore comments cannot hide dead code from the owner's check", async () => {
  const lib = "// fallow-ignore-file\nexport const used = 1;\n// fallow-ignore-next-line unused-export\nexport const unused = 2;\nexport type Unused = number;\n";
  assert.deepEqual(await report({ ...APP, "src/lib.ts": lib }), [
    "src/lib.ts:4 note export unused is not imported anywhere; remove it or say why it is public",
    "src/lib.ts:5 note type Unused is not imported anywhere; remove it or say why it is public",
  ]);
});
