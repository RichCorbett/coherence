import assert from "node:assert/strict";
import { test } from "node:test";
import { CyclesCheck } from "../../src/checks/cycles.ts";
import { tempRepo } from "../helpers/temp-repo.ts";

const A_IMPORTS_B = 'import { b } from "./b.ts";\nexport const a = b;\n';
const B_IMPORTS_A = 'import { a } from "./a.ts";\nexport const b = a;\n';

test("reports a cycle against every file in it, with the whole cycle in the message", async () => {
  const repo = await tempRepo({ "src/x/a.ts": A_IMPORTS_B, "src/x/b.ts": B_IMPORTS_A });
  const findings = await new CyclesCheck().run(repo);
  assert.deepEqual(findings.map((finding) => finding.path).sort(), ["src/x/a.ts", "src/x/b.ts"]);
  for (const finding of findings) assert.match(finding.message, /^import cycle: (src\/x\/a\.ts -> src\/x\/b\.ts|src\/x\/b\.ts -> src\/x\/a\.ts) -> src\/x\/[ab]\.ts;/);
});

test("counts a cycle that exists only through import type", async () => {
  const repo = await tempRepo({
    "src/x/a.ts": 'import type { B } from "./b.ts";\nexport type A = { b?: B };\n',
    "src/x/b.ts": 'import type { A } from "./a.ts";\nexport type B = { a?: A };\n',
  });
  assert.equal((await new CyclesCheck().run(repo)).length, 2);
});

test("a file named like a flag is read as a path, not as an option to the tool", async () => {
  const repo = await tempRepo({
    "src/x/--not-an-option.ts": "export const x = 1;\n",
    "src/x/a.ts": A_IMPORTS_B,
    "src/x/b.ts": B_IMPORTS_A,
  });
  assert.equal((await new CyclesCheck().run(repo)).length, 2);
});

test("passes imports that point one way, and a repo with no script files", async () => {
  const oneWay = await tempRepo({ "src/x/a.ts": A_IMPORTS_B, "src/x/b.ts": "export const b = 1;\n" });
  assert.deepEqual(await new CyclesCheck().run(oneWay), []);
  assert.deepEqual(await new CyclesCheck().run(await tempRepo({ "notes.md": "hi\n" })), []);
});
