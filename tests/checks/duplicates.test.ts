import assert from "node:assert/strict";
import { test } from "node:test";
import { DuplicatesCheck } from "../../src/checks/duplicates.ts";
import { filesPastArgMax } from "../helpers/sandbox.ts";
import { tempRepo } from "../helpers/temp-repo.ts";

const BLOCK = Array.from({ length: 40 }, (_, i) => `export function f${i}(a: number, b: number) { const total = a + b * ${i}; return total > 10 ? total : a; }`).join("\n");

test("reports a clone against each file involved, naming the other location", async () => {
  const repo = await tempRepo({ "src/a/one.ts": `${BLOCK}\n`, "src/b/two.ts": `${BLOCK}\n` });
  const findings = await new DuplicatesCheck().run(repo);
  assert.deepEqual(findings.map((finding) => finding.path).sort(), ["src/a/one.ts", "src/b/two.ts"]);
  assert.equal(findings[0].line, 1);
  assert.match(findings.find((finding) => finding.path === "src/a/one.ts")!.message, /src\/b\/two\.ts:1-40/);
});

test("a file named like a flag is read as a path, not as an option to the tool", async () => {
  const repo = await tempRepo({ "src/--not-an-option.ts": "export const x = 1;\n", "src/a/one.ts": `${BLOCK}\n`, "src/b/two.ts": `${BLOCK}\n` });
  assert.equal((await new DuplicatesCheck().run(repo)).length, 2);
});

test("does not scan fixtures", async () => {
  const repo = await tempRepo({ "tests/fixtures/one.ts": `${BLOCK}\n`, "tests/fixtures/two.ts": `${BLOCK}\n` });
  assert.deepEqual(await new DuplicatesCheck().run(repo), []);
});

test("runs on a repo with more files than fit on one command line", { timeout: 120_000 }, async () => {
  const repo = await tempRepo({ ...filesPastArgMax(), "src/a/one.ts": `${BLOCK}\n`, "src/b/two.ts": `${BLOCK}\n` });
  assert.deepEqual((await new DuplicatesCheck().run(repo)).map((finding) => finding.path).sort(), ["src/a/one.ts", "src/b/two.ts"]);
});
