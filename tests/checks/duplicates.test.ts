import assert from "node:assert/strict";
import { test } from "node:test";
import { DuplicatesCheck } from "../../src/checks/duplicates.ts";
import { tempRepo } from "../helpers/temp-repo.ts";

const BLOCK = Array.from({ length: 40 }, (_, i) => `export function f${i}(a: number, b: number) { const total = a + b * ${i}; return total > 10 ? total : a; }`).join("\n");

test("reports a clone against each file involved, naming the other location", async () => {
  const repo = await tempRepo({ "one.ts": `${BLOCK}\n`, "two.ts": `${BLOCK}\n` });
  const findings = await new DuplicatesCheck().run(repo);
  assert.deepEqual(findings.map((finding) => finding.path).sort(), ["one.ts", "two.ts"]);
  assert.equal(findings[0].line, 1);
  assert.match(findings.find((finding) => finding.path === "one.ts")!.message, /two\.ts:1-40/);
});

test("does not scan fixtures", async () => {
  const repo = await tempRepo({ "tests/fixtures/one.ts": `${BLOCK}\n`, "tests/fixtures/two.ts": `${BLOCK}\n` });
  assert.deepEqual(await new DuplicatesCheck().run(repo), []);
});
