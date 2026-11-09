import assert from "node:assert/strict";
import { test } from "node:test";
import { CyclesCheck } from "../../src/checks/cycles.ts";
import { tempRepo } from "../helpers/temp-repo.ts";

test("reports a cycle once, against its first file, with the whole cycle in the message", async () => {
  const repo = await tempRepo({
    "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
    "b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
  });
  const findings = await new CyclesCheck().run(repo);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "a.ts");
  assert.match(findings[0].message, /a\.ts -> b\.ts -> a\.ts/);
});

test("counts a cycle that exists only through import type", async () => {
  const repo = await tempRepo({
    "a.ts": 'import type { B } from "./b.ts";\nexport type A = { b?: B };\n',
    "b.ts": 'import type { A } from "./a.ts";\nexport type B = { a?: A };\n',
  });
  assert.equal((await new CyclesCheck().run(repo)).length, 1);
});

test("passes imports that point one way, and a repo with no script files", async () => {
  const oneWay = await tempRepo({ "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n', "b.ts": "export const b = 1;\n" });
  assert.deepEqual(await new CyclesCheck().run(oneWay), []);
  assert.deepEqual(await new CyclesCheck().run(await tempRepo({ "notes.md": "hi\n" })), []);
});
