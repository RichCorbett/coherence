import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CyclesCheck } from "../../src/checks/cycles.ts";
import { Repo } from "../../src/lib/repo.ts";
import { tempFolder, writeFiles } from "../helpers/sandbox.ts";
import { git, tempRepo } from "../helpers/temp-repo.ts";

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

const ALIAS_TSCONFIG = '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }\n';
const ALIAS_FILES = {
  "tsconfig.json": ALIAS_TSCONFIG,
  "src/a.ts": 'import { b } from "@lib/b";\nexport const a = b;\n',
  "src/lib/b.ts": 'import { a } from "../a.ts";\nexport const b = a;\n',
};

test("finds a cycle that runs through a path alias from the repo's tsconfig", async () => {
  const repo = await tempRepo(ALIAS_FILES);
  assert.deepEqual((await new CyclesCheck().run(repo)).map((finding) => finding.path).sort(), ["src/a.ts", "src/lib/b.ts"]);
});

test("a tsconfig that is a symlink is not handed to the tool", async () => {
  // The repo under review could point the link at a file outside it; the alias cycle is then missed, never read through.
  const outside = join(tempFolder(), "outside.json");
  writeFileSync(outside, ALIAS_TSCONFIG);
  const root = tempFolder();
  writeFiles(root, { "src/a.ts": ALIAS_FILES["src/a.ts"], "src/lib/b.ts": ALIAS_FILES["src/lib/b.ts"] });
  symlinkSync(outside, join(root, "tsconfig.json"));
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
  assert.deepEqual(await new CyclesCheck().run(await Repo.open(root)), []);
});
