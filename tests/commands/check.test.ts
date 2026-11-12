import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { Repo } from "../../src/lib/repo.ts";
import { writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

const CYCLE = {
  "src/a/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
  "src/a/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
};

async function commitBranchChange(root: string, files: Record<string, string>): Promise<void> {
  git(root, "checkout", "-q", "-b", "work");
  writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
}

test("exits with findings and names the finding when the repo breaks a rule", async () => {
  const repo = await tempRepo(CYCLE);
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.match(invocation.printed[0], /\[cycles\]/);
});

test("with --base, reports only files the branch changed", async () => {
  const repo = await tempRepo({ ...CYCLE });
  await commitBranchChange(repo.root, { "src/a/new.ts": "export const fresh = 1;\n" });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), Exit.ok);
});

test("with --base, a file of the same name in another folder is not the changed file", async () => {
  const repo = await tempRepo({ ...CYCLE });
  await commitBranchChange(repo.root, { "src/b/a.ts": "export const other = 1;\n" });
  assert.equal(await new CheckCommand().execute(fakeInvocation(repo.root, ["--base", "main"])), Exit.ok);
});

test("with --base, a branch that edits only one file of a cycle still answers for it", async () => {
  const repo = await tempRepo({
    "src/x/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
    "src/x/b.ts": "export const b = 1;\n",
  });
  await commitBranchChange(repo.root, { "src/x/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n' });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.ok(invocation.printed.some((line) => line.startsWith("src/x/b.ts [cycles]")));
});

test("with --base, still reports a folder the branch added to", async () => {
  const crowded = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`src/f${i}.ts`, "x\n"]));
  const repo = await tempRepo(crowded);
  await commitBranchChange(repo.root, { "src/one-more.ts": "x\n" });
  const invocation = fakeInvocation(repo.root, ["--base", "main"]);
  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.ok(invocation.printed.some((line) => line.startsWith("src [flat-folder]")));
});

test("with --base, an edit in an already crowded folder is not the branch's crowding", async () => {
  const crowded = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`src/f${i}.ts`, "x\n"]));
  const repo = await tempRepo(crowded);
  await commitBranchChange(repo.root, { "src/f0.ts": "y\n" });
  assert.equal(await new CheckCommand().execute(fakeInvocation(repo.root, ["--base", "main"])), Exit.ok);
});

test("with --base, a folder the branch grew while over the limit is reported", async () => {
  const crowded = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`src/f${i}.ts`, "x\n"]));
  const repo = await tempRepo(crowded);
  await commitBranchChange(repo.root, { "src/one-more.ts": "x\n" });
  assert.equal(await new CheckCommand().execute(fakeInvocation(repo.root, ["--base", "main"])), Exit.findings);
});

/** A package claiming to be the pinned tool, which leaves a file behind in the repo if it is ever run. */
function plantedTool(name: string, version: string) {
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version, bin: { [name]: "fake.js" } }),
    [`node_modules/${name}/fake.js`]: `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(`PLANTED-${name}`)}, "ran");\nconsole.log("[]");\n`,
  };
}

test("a tool planted in the reviewed repo's node_modules is never run", async () => {
  const repo = await tempRepo({ ...CYCLE, ...plantedTool("madge", "8.0.0"), ...plantedTool("jscpd", "5.4.3") });
  mkdirSync(join(repo.root, "node_modules/.bin"));
  for (const name of ["madge", "jscpd"]) {
    chmodSync(join(repo.root, "node_modules", name, "fake.js"), 0o755);
    symlinkSync(`../${name}/fake.js`, join(repo.root, "node_modules/.bin", name));
  }
  const invocation = fakeInvocation(repo.root);

  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.deepEqual(readdirSync(repo.root).filter((name) => name.startsWith("PLANTED")), []);
  assert.match(invocation.printed.join("\n"), /import cycle/);
});

test("a --base that looks like a git option is read as a ref, so it cannot write a file", async () => {
  const repo = await tempRepo({ "src/a/one.ts": "export const one = 1;\n" });
  await assert.rejects(new CheckCommand().execute(fakeInvocation(repo.root, ["--base=--output=WRITTEN"])));
  assert.equal(existsSync(join(repo.root, "WRITTEN...HEAD")), false);
});

test("says how many source files it skipped under build, dist, vendor and fixtures folders", async () => {
  const repo = await tempRepo({ "src/build/pipeline.ts": "export const p = 1;\n", "src/real.ts": "export const r = 1;\n" });
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new CheckCommand().execute(invocation), Exit.ok);
  assert.ok(invocation.printed.some((line) => line.includes("skipped 1 source file(s)")));
});

test("says nothing about skipping when nothing was skipped", async () => {
  const repo = await tempRepo({ "src/real.ts": "export const r = 1;\n" });
  const invocation = fakeInvocation(repo.root);
  await new CheckCommand().execute(invocation);
  assert.deepEqual(invocation.printed, ["coherence check: clean"]);
});

test("a failure to count skipped files is reported but does not fail the check", async (t) => {
  const repo = await tempRepo({ "src/real.ts": "export const r = 1;\n" });
  t.mock.method(Repo.prototype, "skippedSourceFiles", async () => {
    throw new Error("boom");
  });
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new CheckCommand().execute(invocation), Exit.ok);
  assert.ok(invocation.printed.some((line) => line.includes("could not count skipped files: boom")));
  assert.equal(invocation.printed.at(-1), "coherence check: clean");
});
