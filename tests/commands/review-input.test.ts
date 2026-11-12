import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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
  assert.match(out, new RegExp(`^BASE ${base}\\nHEAD ${await repo.headCommit()}\\nBRANCH feature\\n`));
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

  git(repo.root, "checkout", "-q", "--detach");
  assert.match((await run(repo.root, [])).out, /^BASE none\nHEAD [0-9a-f]{40}\nBRANCH none\n/);
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
  const path = out.match(/^The full diff is (\d+) lines, too long to paste \(over 3000 lines or 200 KB\)\. Read it in chunks from (.+)$/m);
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

test("a diff under 3000 lines but over 200 KB is written to a file too", async (t) => {
  const wide = Array.from({ length: 100 }, (_, i) => `export const w${i} = "${"x".repeat(3000)}";`).join("\n") + "\n";
  const { repo, cache } = await branchedRepo(t, { "a.ts": "x\n" }, { "wide.ts": wide });
  const { out } = await run(repo.root, ["--base", "main"]);

  const path = out.match(/Read it in chunks from (.+)$/m);
  assert.ok(path, "a diff over 200 KB must go to a file");
  assert.ok(path[1].startsWith(cache));
  assert.ok(out.length < 200 * 1024, "the pasted part must stay small");
});

test("the diff and the HEAD it names are one commit, even if HEAD has moved on", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "x\n" }, { "b.ts": "first\n" });
  const first = await repo.headCommit();
  writeFiles(repo.root, { "c.ts": "second\n" });
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "later");
  const base = await repo.resolveCommit("main");

  const patch = await repo.patchBetween(base, first);

  assert.match(patch, /\+first/);
  assert.doesNotMatch(patch, /second/, "a later HEAD must not leak into the diff");
  assert.doesNotMatch(await repo.statBetween(base, first), /c\.ts/);
  assert.match((await run(repo.root, ["--base", "main"])).out, new RegExp(`^BASE ${base}\\nHEAD ${await repo.headCommit()}\\n`));
});

test("a diff past the process output limit fails with one clear line", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "x\n" }, { "b.ts": "y\n" });
  // Unique per line, so nothing can shrink it below the limit.
  const row = (i: number) => `${i.toString(16).padStart(8, "0")}${"abcdefghijklmnopqrstuvwxyz0123456789".repeat(28)}`;
  writeFileSync(join(repo.root, "huge.txt"), Array.from({ length: 70 * 1024 }, (_, i) => row(i)).join("\n") + "\n");
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "huge");

  await assert.rejects(run(repo.root, ["--base", "main"]), (error: Error) => {
    assert.equal(error.message, "the diff is over the 64 MB limit and cannot be read");
    return true;
  });
});

test("saved patches older than a day are removed, and nothing else in the cache is", async (t) => {
  const { repo, cache } = await branchedRepo(t, { "a.ts": "x\n" }, { "b.ts": "y\n" });
  const parent = join(cache, "coherence");
  const outside = tempFolder();
  writeFileSync(join(outside, "keep.txt"), "mine\n");
  const age = (path: string, hours: number) => {
    const when = new Date(Date.now() - hours * 3600 * 1000);
    utimesSync(path, when, when);
  };
  for (const name of ["review-old", "review-recent", "run-old", "other-old"]) {
    mkdirSync(join(parent, name), { recursive: true });
    writeFileSync(join(parent, name, "f"), "x");
  }
  writeFileSync(join(parent, "review-a-file"), "x");
  symlinkSync(outside, join(parent, "review-link"));
  for (const name of ["review-old", "run-old", "other-old", "review-a-file"]) age(join(parent, name), 25);
  age(join(parent, "review-recent"), 23);
  age(outside, 25);

  await run(repo.root, ["--base", "main"]);

  assert.equal(existsSync(join(parent, "review-old")), false, "an old review folder goes");
  assert.equal(existsSync(join(parent, "review-recent")), true, "a recent one stays");
  assert.equal(existsSync(join(parent, "run-old")), true, "another prefix stays");
  assert.equal(existsSync(join(parent, "other-old")), true, "another prefix stays");
  assert.equal(existsSync(join(parent, "review-a-file")), true, "a file is not a folder we made");
  assert.equal(existsSync(join(outside, "keep.txt")), true, "a symlink is never followed");
  assert.equal(lstatSync(join(parent, "review-link")).isSymbolicLink(), true, "a symlink is not a folder we made");
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

test("taste entries added since the previous review get their own section, and each run moves that point forward", async (t) => {
  const { repo } = await branchedRepo(t, { "a.ts": "x\n" }, { "b.ts": "y\n" });
  const config = join(process.env.XDG_CONFIG_HOME!, "coherence");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "taste-log.md"), "- 2020-01-01 old log line\n- 2099-01-01 fresh log line\n");
  // A condensed entry is new too, or condensing would hide it from the owner.
  writeFileSync(join(config, "taste-archive.md"), "- 2020-01-02 old archived line\n- 2099-01-02 fresh archived line\n");
  const section = (out: string) => out.slice(out.indexOf("=== NEW TASTE"), out.indexOf("=== DESIGN RULES ==="));

  const first = (await run(repo.root, ["--base", "main"])).out;
  assert.match(section(first), /no previous review/);
  assert.match(section(first), /old log line[\s\S]*fresh log line|fresh log line[\s\S]*old log line/);
  assert.ok(first.indexOf("=== OWNER TASTE ===") < first.indexOf("=== NEW TASTE") && first.indexOf("=== NEW TASTE") < first.indexOf("=== DESIGN RULES ==="));

  writeFileSync(join(config, "taste-last-review"), "2050-01-01\n");
  const second = section((await run(repo.root, ["--base", "main"])).out);
  assert.match(second, /fresh log line/);
  assert.match(second, /fresh archived line/);
  assert.doesNotMatch(second, /old log line|old archived line/);

  await run(repo.root, ["--base", "main"]);
  assert.match(readFileSync(join(config, "taste-last-review"), "utf8"), new RegExp(`^${new Date().toISOString().slice(0, 10)}\\n$`));
  writeFileSync(join(config, "taste-log.md"), "- 2020-01-01 old log line\n");
  writeFileSync(join(config, "taste-archive.md"), "");
  const none = section((await run(repo.root, ["--base", "main"])).out);
  assert.match(none, /none/);
  assert.doesNotMatch(none, /old log line/);
});
