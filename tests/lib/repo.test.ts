import assert from "node:assert/strict";
import { readdirSync, rmSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
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
