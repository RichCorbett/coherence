import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { disarmSuppressions as disarm } from "../../src/lib/repo.ts";
import { tempFolder, writeFiles } from "../helpers/sandbox.ts";
import { git, tempRepo } from "../helpers/temp-repo.ts";

test("sourceFiles sees a new file before git add, and still honors .gitignore", async () => {
  const repo = await tempRepo({ "src/a.ts": "a\n", ".gitignore": "out/\n" });
  writeFiles(repo.root, { "src/new.ts": "n\n", "out/built.js": "b\n", "src/notes.md": "m\n" });
  assert.equal(git(repo.root, "ls-files", "src/new.ts"), "");
  assert.deepEqual((await repo.sourceFiles()).sort(), ["src/a.ts", "src/new.ts"]);
});

test("copySourceFiles copies source, package.json and tsconfig files, and nothing else: no .git, no tool config, no symlink", async () => {
  const outside = tempFolder();
  writeFiles(outside, { "secret.ts": "export const s = 1;\n", "c.ts": "outside\n" });
  const repo = await tempRepo({
    "src/a.ts": "a\n",
    "src/b/c.ts": "c\n",
    "pkg/package.json": "{}\n",
    "tsconfig.build.json": "{}\n",
    ".fallowrc.json": "{}\n",
    ".gitignore": "out/\n",
    "test/fixtures/f.ts": "f\n",
    "src/b/notes.md": "m\n",
  });
  writeFiles(repo.root, { "out/built.ts": "b\n", "src/new.ts": "n\n" });
  symlinkSync(join(outside, "secret.ts"), repo.absolutePath("src/link.ts"));
  // A tracked folder replaced by a link to a folder holding a file of the same name: git still lists the file under it.
  rmSync(repo.absolutePath("src/b"), { recursive: true });
  symlinkSync(outside, repo.absolutePath("src/b"));

  const copy = tempFolder();
  await repo.copySourceFiles(copy);
  const copied = readdirSync(copy, { recursive: true, withFileTypes: true }).filter((entry) => !entry.isDirectory());
  assert.ok(copied.every((entry) => entry.isFile()));
  assert.deepEqual(copied.map((entry) => relative(copy, join(entry.parentPath, entry.name))).sort(), ["pkg/package.json", "src/a.ts", "src/new.ts", "tsconfig.build.json"]);
});

test("an untracked file counts as uncommitted even when the repository config hides untracked files from status", async () => {
  const repo = await tempRepo({ "a.ts": "export const a = 1;\n" });
  git(repo.root, "config", "status.showUntrackedFiles", "no");
  assert.equal(await repo.hasUncommittedChanges(), false);
  writeFiles(repo.root, { "notes.ts": "scratch\n" });
  assert.equal(await repo.hasUncommittedChanges(), true);
});

test("disarming rewrites the tools' suppression comments, not import paths or strings that hold the same words", async () => {
  const file = join(tempFolder(), "a.ts");
  const lines = [
    'import { helper } from "./fallow-ignore-utils.ts";',
    "// fallow-ignore-next-line unused-export",
    'const label = "ast-grep-ignore";',
    "x(); // ast-grep-ignore: no-log",
    "// a note that says fallow-ignore later, which no tool obeys",
    'const url = "https://example.com/fallow-ignore"; // fallow-ignore-next-line',
    'import { sub } from "#fallow-ignore-utils";',
    "/* fallow-ignore-next-line unused-export */",
    "/**",
    " * fallow-ignore-file",
    " */",
    'import { alias } from "#ast-grep-ignore-utils";',
    "/** ast-grep-ignore */",
    "//\u00a0fallow-ignore-next-line",
    "// - ast-grep-ignore",
    "/*",
    "\u2003fallow-ignore-file */",
    "// x ast-grep-ignore",
  ];
  writeFileSync(file, `${lines.join("\n")}\n`);
  await disarm(file);
  assert.deepEqual(readFileSync(file, "utf8").split("\n").slice(0, -1), [
    'import { helper } from "./fallow-ignore-utils.ts";',
    "// FALLOW-IGNORE-next-line unused-export",
    'const label = "ast-grep-ignore";',
    "x(); // AST-GREP-IGNORE: no-log",
    "// a note that says fallow-ignore later, which no tool obeys",
    'const url = "https://example.com/fallow-ignore"; // FALLOW-IGNORE-next-line',
    'import { sub } from "#fallow-ignore-utils";',
    "/* FALLOW-IGNORE-next-line unused-export */",
    "/**",
    " * FALLOW-IGNORE-file",
    " */",
    'import { alias } from "#ast-grep-ignore-utils";',
    "/** AST-GREP-IGNORE */",
    "//\u00a0FALLOW-IGNORE-next-line",
    "// - AST-GREP-IGNORE",
    "/*",
    "\u2003FALLOW-IGNORE-file */",
    "// x ast-grep-ignore",
  ]);
  // # opens a comment only in Python and Ruby, and there // does not.
  const python = join(tempFolder(), "a.py");
  writeFileSync(python, "#\u00a0ast-grep-ignore\nx = 7 // 2  # ast-grep-ignore: no-floor\ny = '// fallow-ignore-file'\n");
  await disarm(python);
  assert.equal(readFileSync(python, "utf8"), "#\u00a0AST-GREP-IGNORE\nx = 7 // 2  # AST-GREP-IGNORE: no-floor\ny = '// fallow-ignore-file'\n");
});

test("disarming a line of 200 000 slashes takes well under the 20s that looking forward from every opener took", async () => {
  const file = join(tempFolder(), "a.ts");
  writeFileSync(file, `${"/".repeat(200_000)}\n`);
  const start = Date.now();
  await disarm(file);
  assert.ok(Date.now() - start < 2000, `took ${Date.now() - start}ms`);
});
