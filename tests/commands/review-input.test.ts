import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { ReviewInputCommand } from "../../src/commands/review-input.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { isolatedPlugin, setEnv, tempFolder, writeFiles, type Files } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

/** A repo with `before` on main and `after` committed on top on a branch, with the plugin and cache folders isolated. */
async function branchedRepo(t: TestContext, before: Files, after: Files, removed: string[] = []) {
  isolatedPlugin(t, { "rules/design.md": "# Rules\n\n- one voice\n", "taste/style.md": "# Style\n\n- plain words\n" });
  const cache = tempFolder();
  setEnv(t, { XDG_CACHE_HOME: cache });
  const repo = await tempRepo(before);
  git(repo.root, "checkout", "-q", "-b", "feature");
  for (const path of removed) git(repo.root, "rm", "-q", path);
  writeFiles(repo.root, after);
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "change");
  return { repo, cache };
}

async function run(cwd: string, args: string[]) {
  const invocation = fakeInvocation(cwd, args);
  const code = await new ReviewInputCommand().execute(invocation);
  return { code, out: invocation.printed.join("\n"), printed: invocation.printed };
}

test("prints the commit IDs, the taste, the rules and the diff, with the diff last", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "export const a = 1;\n" }, { "b.ts": "export const b = 2;\n" });
  const base = (await repo.resolveCommit("main"));
  const { code, out } = await run(repo.root, ["--base", "main"]);

  assert.equal(code, Exit.ok);
  assert.match(out, new RegExp(`^BASE ${base}\\nHEAD ${await repo.headCommit()}\\n`));
  const order = ["=== OWNER TASTE ===", "- plain words", "=== DESIGN RULES ===", "- one voice", "=== BEGIN DIFF ===", "+export const b = 2;"].map((part) => out.indexOf(part));
  assert.ok(order.every((at) => at >= 0), `a section is missing:\n${out}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(out.trimEnd().endsWith("+export const b = 2;"), "nothing may follow the diff");
});

test("with no base it asks for the whole repository and prints no diff", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "export const a = 1;\n" }, { "b.ts": "export const b = 2;\n" });
  const { out } = await run(repo.root, []);
  assert.match(out, /^BASE none\nHEAD [0-9a-f]{40}/);
  assert.match(out, /=== NO DIFF ===/);
  assert.doesNotMatch(out, /BEGIN DIFF/);
});

test("a ref that is not plainly a name is refused before git or a shell sees it", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "x\n" }, { "b.ts": "y\n" });
  const ran = join(tempFolder(), "RAN");
  const refused = new RegExp("not a usable ref name");
  for (const ref of [`$(touch ${ran})`, `main;touch ${ran}`, "`touch x`", "main^{commit}", "a b", ""]) {
    const invocation = fakeInvocation(repo.root, ["--base", ref]);
    await assert.rejects(new ReviewInputCommand().execute(invocation), refused, ref);
    assert.deepEqual(invocation.printed, [], ref);
  }
  assert.equal(existsSync(ran), false);
});

test("a ref that starts with a dash is refused, so it can never pass for an option", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "x\n" }, { "b.ts": "y\n" });
  for (const ref of ["-x", "--output=/tmp/x", "--help"]) {
    const invocation = fakeInvocation(repo.root, [`--base=${ref}`]);
    await assert.rejects(new ReviewInputCommand().execute(invocation), /not a usable ref name/, ref);
    assert.deepEqual(invocation.printed, [], ref);
    // Written as two words, the option parser refuses it before the command looks.
    await assert.rejects(new ReviewInputCommand().execute(fakeInvocation(repo.root, ["--base", ref])), ref);
  }
});

test("a name that is not a commit fails with one line", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "x\n" }, { "b.ts": "y\n" });
  await assert.rejects(new ReviewInputCommand().execute(fakeInvocation(repo.root, ["--base", "nope"])), (error: Error) => {
    assert.match(error.message, /^nope is not a commit/);
    assert.doesNotMatch(error.message, /\n/);
    return true;
  });
});

test("a diff over 3000 lines is written outside the repo, deleted files included, and only its stat is printed", async (t) => {
  const big = Array.from({ length: 3100 }, (_, i) => `export const n${i} = ${i};`).join("\n") + "\n";
  const { repo, cache } = await branchedRepo(t, { "gone.ts": "export const gone = 1;\n" }, { "big.ts": big }, ["gone.ts"]);
  const { code, out } = await run(repo.root, ["--base", "main"]);

  assert.equal(code, Exit.ok);
  const path = out.match(/^The full diff is (\d+) lines, too long to paste\. Read it in chunks from (.+)$/m);
  assert.ok(path, out);
  assert.ok(Number(path[1]) > 3000);
  assert.ok(path[2].startsWith(cache), "the patch belongs in coherence's cache area");
  assert.ok(!path[2].startsWith(repo.root), "the patch must not be written inside the repo under review");
  const patch = readFileSync(path[2], "utf8");
  assert.match(patch, /deleted file mode/);
  assert.match(patch, /^-export const gone = 1;$/m);
  assert.match(patch, /^\+export const n3099 = 3099;$/m);
  assert.doesNotMatch(out, /export const n3099/, "the pasted part must not carry the patch");
  const stat = out.slice(out.indexOf("=== BEGIN DIFF ==="));
  assert.ok(stat.includes("gone.ts") && stat.includes("big.ts"), stat);
});

test("a diff or textconv command named by the repo is not run", async (t) => {
  const { repo } = await branchedRepo(t, { "notes.txt": "one\n" }, { "notes.txt": "two\n" });
  const ran = join(tempFolder(), "RAN");
  writeFiles(repo.root, { ".gitattributes": "*.txt diff=evil\n" });
  git(repo.root, "add", ".gitattributes");
  git(repo.root, "commit", "-q", "-m", "attributes");
  git(repo.root, "config", "diff.evil.textconv", `sh -c 'touch ${ran}; cat "$0"'`);
  git(repo.root, "config", "diff.evil.command", `touch ${ran}`);
  writeFiles(repo.root, { "notes.txt": "three\n" });
  git(repo.root, "commit", "-q", "-a", "-m", "edit");

  const { code, out } = await run(repo.root, ["--base", "main"]);

  assert.equal(code, Exit.ok);
  assert.match(out, /^\+three$/m, "the real change is in the diff");
  assert.equal(existsSync(ran), false);
});
