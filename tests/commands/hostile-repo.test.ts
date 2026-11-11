import assert from "node:assert/strict";
import { chmodSync, existsSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CyclesCheck } from "../../src/checks/cycles.ts";
import { DuplicatesCheck } from "../../src/checks/duplicates.ts";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { PrGateCommand } from "../../src/commands/pr-gate.ts";
import { setEnv, tempFolder, writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

/**
 * Turns `folder`, already inside a repo, into a bare-looking repository of its own whose config runs `command` from a clean filter.
 * Returns the commit it holds.
 */
function plantBareRepositoryThatRuns(folder: string, command: string, file: string): string {
  git(folder, "init", "-q", "--bare", "-b", "main", ".");
  for (const [key, value] of [["core.bare", "false"], ["core.worktree", "."]]) {
    git(folder, "--git-dir=.", "config", key, value);
  }
  git(folder, "--git-dir=.", "--work-tree=.", "add", file);
  git(folder, "--git-dir=.", "--work-tree=.", "commit", "-q", "-m", "planted");
  // A clean filter, not core.fsmonitor, so that core.fsmonitor=false cannot stop it and only safe.bareRepository does.
  // Set last, or the two commands above would run it while the attack is still being set up.
  writeFileSync(join(folder, "info/attributes"), `${file} filter=planted\n`);
  git(folder, "--git-dir=.", "config", "filter.planted.clean", `${command}; cat`);
  // A newer mtime makes `git status` read the file through the filter.
  utimesSync(join(folder, file), new Date(), new Date(Date.now() + 60_000));
  return git(folder, "--git-dir=.", "rev-parse", "HEAD");
}

/** Turns `folder`, already inside a repo, into an ordinary nested repository whose core.fsmonitor runs `command`. Returns the commit it holds. */
function plantNestedRepositoryThatRuns(folder: string, command: string, file: string): string {
  // A .git folder, which safe.bareRepository does not refuse, so only core.fsmonitor=false stops it.
  git(folder, "init", "-q", "-b", "main");
  git(folder, "add", file);
  git(folder, "commit", "-q", "-m", "planted");
  // Last, or the two commands above would run it while the attack is still being set up.
  git(folder, "config", "core.fsmonitor", command);
  return git(folder, "--git-dir=.git", "rev-parse", "HEAD");
}

/** `touch <path>` as shell text that stays one word, so a temp folder with a space in its name cannot turn the plant into a no-op. */
function touchCommand(path: string): string {
  return `touch '${path.replaceAll("'", "'\\''")}'`;
}

/** A repo with `plant` set up in src/lib, and a `pr-gate pass` invocation from there for the commit the plant holds. */
async function plantedPass(plant: (folder: string, command: string, file: string) => string) {
  const repo = await tempRepo({ "src/lib/client.ts": "export {};\n" });
  const ran = join(tempFolder(), "RAN");
  const folder = join(repo.root, "src/lib");
  const head = plant(folder, touchCommand(ran), "client.ts");
  const invocation = fakeInvocation(folder, ["pass", "--branch", "main", "--verdict", "merge", "--head", head]);
  return { ran, folder, head, invocation, execute: () => new PrGateCommand(new CheckCommand()).execute(invocation) };
}

// Through `pr-gate pass`, which runs both the checks and `git status`, so each plant meets a git command that would run it.
// Each test asserts the exact outcome, so a refusal for some other reason, before git is reached, fails the test instead of passing it.

test("a bare repository planted in the folder the review starts from cannot make git run its command", async () => {
  const { ran, folder, execute } = await plantedPass(plantBareRepositoryThatRuns);

  // Refused at discovery: git will not use a repository it found by walking into a folder that looks bare.
  await assert.rejects(execute(), { message: `not a git repository: ${folder}` });
  assert.equal(existsSync(ran), false);
});

test("a nested repository planted in the folder the review starts from cannot make git run its command", async () => {
  const { ran, head, invocation, execute } = await plantedPass(plantNestedRepositoryThatRuns);

  // A recorded review means the checks and `git status` both ran against the planted repository.
  assert.equal(await execute(), Exit.ok);
  assert.ok(invocation.printed.includes(`recorded a coherence review for main at ${head.slice(0, 8)}`), invocation.printed.join("\n"));
  assert.equal(existsSync(ran), false);
});

test("tools and tool config planted in the repo or above the temp folder are never used", async (t) => {
  const A_IMPORTS_B = 'import { b } from "./b.ts";\nexport const a = b;\n';
  const B_IMPORTS_A = 'import { a } from "./a.ts";\nexport const b = a;\n';
  const BLOCK = Array.from({ length: 40 }, (_, i) => `export function f${i}(a: number) { const total = a * ${i}; return total > 10 ? total : a; }`).join("\n");
  const repo = await tempRepo({ "src/x/a.ts": A_IMPORTS_B, "src/x/b.ts": B_IMPORTS_A, "src/y/one.ts": `${BLOCK}\n`, "src/y/two.ts": `${BLOCK}\n` });
  const sharedTemp = tempFolder();
  const ran = join(sharedTemp, "RAN");
  const fake = `#!/bin/sh\n${touchCommand(ran)}\necho '[]'\n`;
  for (const root of [repo.root, sharedTemp]) {
    // Where a PATH lookup or a package lookup from the repo or the temp folder would find a tool.
    for (const path of ["node_modules/.bin/madge", "node_modules/.bin/jscpd", "node_modules/madge/bin/cli.js", "node_modules/jscpd/run-jscpd.js"]) {
      writeFiles(root, { [path]: fake });
      chmodSync(join(root, path), 0o755);
    }
    // Config each tool reads from its working folder, set to hide everything it would find.
    writeFiles(root, { ".madgerc": '{ "excludeRegExp": [".*"] }\n', ".jscpd.json": '{ "minLines": 1000 }\n' });
  }
  setEnv(t, { TMPDIR: sharedTemp });
  const before = process.cwd();
  process.chdir(repo.root);
  t.after(() => process.chdir(before));

  const cycles = await new CyclesCheck().run(repo);
  const duplicates = await new DuplicatesCheck().run(repo);

  // Finding the real cycle and clone shows the real tools ran, with their own defaults.
  assert.deepEqual(cycles.map((finding) => finding.path).sort(), ["src/x/a.ts", "src/x/b.ts"]);
  assert.deepEqual(duplicates.map((finding) => finding.path).sort(), ["src/y/one.ts", "src/y/two.ts"]);
  assert.equal(existsSync(ran), false);
});
