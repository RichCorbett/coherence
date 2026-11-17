import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import type { Finding } from "../../src/lib/base-check.ts";
import { baselineFile, saveBaseline, withoutBaseline } from "../../src/lib/baseline.ts";
import { Repo } from "../../src/lib/repo.ts";
import { setEnv, tempFolder, writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

function crowded(count: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: count }, (_, at) => [`src/a/f${at}.ts`, `export const f${at} = ${at};\n`]));
}

async function ownerRepo(t: TestContext, files: Record<string, string>): Promise<Repo> {
  setEnv(t, { XDG_CONFIG_HOME: tempFolder() });
  return tempRepo(files);
}

async function check(root: string, args: string[] = []): Promise<{ exit: number; printed: string[] }> {
  const invocation = fakeInvocation(root, args);
  return { exit: await new CheckCommand().execute(invocation), printed: invocation.printed };
}

function commit(root: string, files: Record<string, string>): void {
  writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
}

// The package.json makes a.ts an entry point, so dead-code has nothing to note and the counts below are the cycle's alone.
const CYCLE = {
  "package.json": JSON.stringify({ main: "src/c/a.ts" }),
  "src/c/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
  "src/c/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
};

test("after a baseline, editing a file in an old cycle is clean, and a new cycle is not", async (t) => {
  const repo = await ownerRepo(t, CYCLE);
  assert.equal((await check(repo.root, ["--save-baseline"])).exit, Exit.ok);

  git(repo.root, "checkout", "-q", "-b", "work");
  commit(repo.root, { "src/c/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\nexport const more = 1;\n' });
  const touched = await check(repo.root, ["--base", "main"]);
  assert.equal(touched.exit, Exit.ok);
  assert.ok(touched.printed.includes("coherence check: 2 finding(s) left out because the baseline holds them"));

  commit(repo.root, { "src/d/x.ts": 'import { y } from "./y.ts";\nexport const x = y;\n', "src/d/y.ts": 'import { x } from "./x.ts";\nexport const y = x;\n' });
  const grown = await check(repo.root, ["--base", "main"]);
  assert.equal(grown.exit, Exit.findings);
  assert.ok(grown.printed.some((line) => line.startsWith("src/d/x.ts [cycles]")));
});

test("after a baseline, adding a file to an old crowded folder is still reported", async (t) => {
  const repo = await ownerRepo(t, crowded(20));
  await check(repo.root, ["--save-baseline"]);
  git(repo.root, "checkout", "-q", "-b", "work");
  commit(repo.root, { "src/a/f20.ts": "export const f20 = 20;\n" });
  const grown = await check(repo.root, ["--base", "main"]);
  assert.equal(grown.exit, Exit.findings);
  assert.ok(grown.printed.some((line) => line.startsWith("src/a [flat-folder] 21 source files")));
});

test("without a baseline every finding is reported", async (t) => {
  const repo = await ownerRepo(t, crowded(20));
  assert.equal((await check(repo.root)).exit, Exit.findings);
});

const BLOCK = Array.from({ length: 12 }, (_, at) => `  total = total + values[${at}] * ${at + 3};`).join("\n");
const DUPLICATED = `export function sum(values: number[]): number {\n  let total = 0;\n${BLOCK}\n  return total;\n}\n`;

test("a known duplicate stays known when lines above it move", async (t) => {
  const repo = await ownerRepo(t, { "src/a/one.ts": DUPLICATED, "src/b/two.ts": DUPLICATED.replace("sum", "add") });
  const before = await check(repo.root);
  assert.equal(before.exit, Exit.findings, "the fixture must hold a duplicate for this test to mean anything");
  await check(repo.root, ["--save-baseline"]);

  commit(repo.root, { "src/a/one.ts": `// moved down\n// by two lines\n${DUPLICATED}` });
  assert.equal((await check(repo.root)).exit, Exit.ok);
});

test("each saved entry covers one finding, so a second copy of a known finding is new", async (t) => {
  const repo = await ownerRepo(t, {});
  const one: Finding = { check: "stub", tier: "must-fix", path: "src/a.ts", scope: "file", message: "same" };
  await saveBaseline(repo, [one]);
  const { fresh, known } = await withoutBaseline(repo, [one, { ...one }]);
  assert.equal(known, 1);
  assert.equal(fresh.length, 1);
});

test("a baseline that cannot be read is an error, not an empty baseline", async (t) => {
  const repo = await ownerRepo(t, crowded(20));
  await check(repo.root, ["--save-baseline"]);
  writeFileSync(await baselineFile(repo), "not json");
  await assert.rejects(check(repo.root), /cannot read the baseline/);
});

test("a worktree of the repo reads the repo's baseline", async (t) => {
  const repo = await ownerRepo(t, crowded(20));
  await check(repo.root, ["--save-baseline"]);
  const other = join(tempFolder(), "wt");
  git(repo.root, "worktree", "add", "-q", "-b", "side", other);
  assert.equal((await check(other)).exit, Exit.ok);
});

test("--save-baseline takes no --base, since it records the whole repo", async (t) => {
  const repo = await ownerRepo(t, crowded(20));
  await assert.rejects(check(repo.root, ["--save-baseline", "--base", "main"]), /takes no --base/);
});
