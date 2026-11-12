import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
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

test("an alias that points outside the repo is not followed", async () => {
  // The outside file imports back into the repo, so following the alias would close a cycle.
  for (const outsideTarget of ["absolute", "dotdot"]) {
    const outside = tempFolder();
    const root = tempFolder();
    writeFiles(outside, { "b.ts": `import { a } from "${join(root, "src/a.ts")}";\nexport const b = a;\n` });
    const target = outsideTarget === "absolute" ? `${outside}/*` : `${relative(root, outside)}/*`;
    writeFiles(root, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@out/*": [target] } } }),
      "src/a.ts": 'import { b } from "@out/b";\nexport const a = b;\n',
    });
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "start");
    assert.deepEqual(await new CyclesCheck().run(await Repo.open(root)), [], outsideTarget);
  }
});

test("an extends of a file outside the repo is not followed", async () => {
  const outside = tempFolder();
  writeFileSync(join(outside, "base.json"), ALIAS_TSCONFIG);
  const repo = await tempRepo({ ...ALIAS_FILES, "tsconfig.json": JSON.stringify({ extends: join(outside, "base.json") }) });
  assert.deepEqual(await new CyclesCheck().run(repo), []);
});

test("a tsconfig with comments is read as having no aliases, and a repo without one is unchanged", async () => {
  const commented = await tempRepo({ ...ALIAS_FILES, "tsconfig.json": "// not plain JSON\n" + ALIAS_TSCONFIG });
  assert.deepEqual(await new CyclesCheck().run(commented), []);
  const none = await tempRepo({ "src/x/a.ts": A_IMPORTS_B, "src/x/b.ts": B_IMPORTS_A });
  assert.equal((await new CyclesCheck().run(none)).length, 2);
});

// An alias cycle through `target`, closed by a file in `outside` that imports back into the repo, so following the alias reports it.
async function aliasThroughLink(options: { baseUrl: string; paths: Record<string, string[]> }): Promise<number> {
  const outside = tempFolder();
  const root = tempFolder();
  writeFiles(outside, { "b.ts": `import { a } from "${join(root, "src/a.ts")}";\nexport const b = a;\n` });
  writeFiles(root, {
    "tsconfig.json": JSON.stringify({ compilerOptions: options }),
    "src/a.ts": 'import { b } from "@out/b";\nexport const a = b;\n',
    "src/lib/placeholder.ts": "export const p = 1;\n",
  });
  symlinkSync(outside, join(root, "vendor"));
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
  return (await new CyclesCheck().run(await Repo.open(root))).length;
}

test("a symlink inside the repo that leads outside is not followed as a baseUrl or a target", async () => {
  assert.equal(await aliasThroughLink({ baseUrl: "vendor", paths: { "@out/*": ["*"] } }), 0);
  assert.equal(await aliasThroughLink({ baseUrl: ".", paths: { "@out/*": ["vendor/*"] } }), 0);
  assert.equal(await aliasThroughLink({ baseUrl: ".", paths: { "@out/*": ["vendor/nothing-yet/*"] } }), 0);
});

test("an alias with one target outside the repo is dropped whole", async () => {
  assert.equal(await aliasThroughLink({ baseUrl: ".", paths: { "@out/*": ["src/lib/*", "vendor/*"] } }), 0);
});
