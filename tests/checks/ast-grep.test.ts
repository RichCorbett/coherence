import assert from "node:assert/strict";
import { chmodSync, existsSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { AstGrepCheck } from "../../src/checks/ast-grep.ts";
import { CheckCommand } from "../../src/commands/check.ts";
import { Exit } from "../../src/lib/base-command.ts";
import { setEnv, tempFolder, writeFiles } from "../helpers/sandbox.ts";
import { fakeInvocation, git, tempRepo } from "../helpers/temp-repo.ts";

const NO_LOG = {
  "no-log.yml": "id: no-log\nlanguage: TypeScript\nseverity: error\nmessage: use the logger, not console.log\nrule: { pattern: console.log($$$A) }\n",
  "no-log.match.ts": "console.log(1);\n",
  "no-log.clean.ts": "console.error(1);\n",
};
const NO_ANY = {
  "no-any.yml": "id: no-any\nlanguage: TypeScript\nseverity: warning\nmessage: say what the type is\nrule: { pattern: $X as any }\n",
  "no-any.match.ts": "const a = b as any;\n",
  "no-any.clean.ts": "const a = b as string;\n",
};
const APP = { "src/app.ts": "const a = b as any;\nconsole.log(a);\n" };

/** Gives this test its own owner config folder holding `rules` as the owner's ast-grep rules, and collects what the check writes to stderr. */
function ownerRules(t: TestContext, rules: Record<string, string>): string[] {
  const config = tempFolder();
  writeFiles(join(config, "coherence", "ast-grep"), rules);
  setEnv(t, { XDG_CONFIG_HOME: config });
  const written: string[] = [];
  t.mock.method(process.stderr, "write", (text: string) => written.push(text) > 0);
  return written;
}

async function report(files: Record<string, string>): Promise<string[]> {
  const findings = await new AstGrepCheck().run(await tempRepo(files));
  return findings.map((finding) => `${finding.path}:${finding.line} ${finding.tier} ${finding.message}`).sort();
}

test("a rule at severity error is must-fix and any other severity is a note, each on its line", async (t) => {
  ownerRules(t, { ...NO_LOG, ...NO_ANY });
  assert.deepEqual(await report(APP), [
    "src/app.ts:1 note say what the type is (ast-grep rule no-any)",
    "src/app.ts:2 must-fix use the logger, not console.log (ast-grep rule no-log)",
  ]);
});

test("a rule that does not report its match example, or reports its clean one, is skipped and says so", async (t) => {
  const written = ownerRules(t, {
    ...NO_ANY,
    ...NO_LOG,
    // Written to never match: the agent's way to keep a rule from ever deciding a review.
    "no-log.yml": NO_LOG["no-log.yml"].replace("pattern: console.log", "pattern: console.nothing"),
    "too-wide.yml": "id: too-wide\nlanguage: TypeScript\nseverity: error\nmessage: m\nrule: { kind: call_expression }\n",
    "too-wide.match.ts": "f();\n",
    "too-wide.clean.ts": "g();\n",
  });
  assert.deepEqual(await report(APP), ["src/app.ts:1 note say what the type is (ast-grep rule no-any)"]);
  assert.match(written.join(""), /skipped the ast-grep rule .*no-log\.yml: it does not report its match example\n/);
  assert.match(written.join(""), /skipped the ast-grep rule .*too-wide\.yml: it reports its clean example\n/);
});

test("a rule without both examples, or one ast-grep cannot read, is skipped and the others still run", async (t) => {
  const written = ownerRules(t, {
    ...NO_ANY,
    "untested.yml": NO_LOG["no-log.yml"].replace("no-log", "untested"),
    "untested.match.ts": "console.log(1);\n",
    "broken.yml": "id: [\n",
    "broken.match.ts": "x;\n",
    "broken.clean.ts": "y;\n",
  });
  assert.deepEqual(await report(APP), ["src/app.ts:1 note say what the type is (ast-grep rule no-any)"]);
  assert.match(written.join(""), /untested\.yml: it needs a \.match\. and a \.clean\. example beside it\n/);
  assert.match(written.join(""), /broken\.yml: ast-grep failed: Error: Cannot parse rule /);
});

test("with no rules, or no source files, ast-grep is not run", async (t) => {
  ownerRules(t, {});
  assert.deepEqual(await report(APP), []);
  ownerRules(t, NO_LOG);
  assert.deepEqual(await report({ "notes.md": "console.log(1)\n" }), []);
});

test("through check, an error-level match fails the branch and a note leaves it clean", async (t) => {
  ownerRules(t, { ...NO_LOG, ...NO_ANY });
  const repo = await tempRepo(APP);
  const invocation = fakeInvocation(repo.root);
  assert.equal(await new CheckCommand().execute(invocation), Exit.findings);
  assert.ok(invocation.printed.includes("src/app.ts:2 [ast-grep] use the logger, not console.log (ast-grep rule no-log)"));
  assert.ok(invocation.printed.includes("src/app.ts:1 [ast-grep] note: say what the type is (ast-grep rule no-any)"));
  // The one must-fix is the ast-grep error; dead-code adds its own note about app.ts.
  assert.match(invocation.printed.at(-1) ?? "", /^coherence check: 1 finding\(s\) to fix /);
});

test("ast-grep never sees the repo: its sgconfig, ignore files, symlinks and .git reach nothing, and a dot-folder is still read", async (t) => {
  // A rule outside the repo that reports everything, so a scan that loads the repo's config reports a canary.
  const outside = tempFolder();
  writeFiles(outside, {
    "rules/canary.yml": "id: canary\nlanguage: TypeScript\nseverity: error\nmessage: canary\nrule: { kind: call_expression }\n",
    "secret.ts": "console.log(\"secret\");\n",
  });
  ownerRules(t, NO_LOG);
  const repo = await tempRepo({
    "sgconfig.yml": `ruleDirs: [ ${JSON.stringify(join(outside, "rules"))} ]\n`,
    ".gitignore": "src/ignored.ts\n",
    ".ignore": "src/dot-ignored.ts\n",
    "src/ignored.ts": "console.log(1);\n",
    "src/dot-ignored.ts": "console.log(2);\n",
    "src/.hidden/x.ts": "console.log(3);\n",
  });
  // Tracked although ignored, so git lists it as the repo's code, and only ast-grep's own ignore handling could leave it out.
  git(repo.root, "add", "-f", "src/ignored.ts");
  symlinkSync(join(outside, "secret.ts"), repo.absolutePath("src/linked.ts"));
  const marker = join(outside, "fsmonitor-ran");
  git(repo.root, "config", "core.fsmonitor", `touch '${marker}'; false`);

  const findings = await new AstGrepCheck().run(repo);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(findings.map((finding) => `${finding.path} ${finding.message}`).sort(), [
    "src/.hidden/x.ts use the logger, not console.log (ast-grep rule no-log)",
    "src/dot-ignored.ts use the logger, not console.log (ast-grep rule no-log)",
    "src/ignored.ts use the logger, not console.log (ast-grep rule no-log)",
  ]);
});

test("the example rules in tests/fixtures/ast-grep-rules pass their own examples and report their match example in a repo", async (t) => {
  const folder = join(import.meta.dirname, "../fixtures/ast-grep-rules");
  const examples = Object.fromEntries(readdirSync(folder).map((name) => [name, readFileSync(join(folder, name), "utf8")]));
  const written = ownerRules(t, examples);
  const matches = Object.entries(examples).filter(([name]) => name.includes(".match."));
  const findings = await report(Object.fromEntries(matches.map(([name, text]) => [`src/${name}`, text])));
  assert.equal(written.join(""), "");
  assert.deepEqual(findings.map((line) => line.split(":")[0]), matches.map(([name]) => `src/${name}`).sort());
});

test("the repo's ast-grep-ignore comments cannot switch off the owner's rules, and every line keeps its number", async (t) => {
  ownerRules(t, NO_LOG);
  const lines = ["// ast-grep-ignore", "console.log(1);", "// ast-grep-ignore: no-log", "console.log(2);", "console.log(3); // ast-grep-ignore"];
  const findings = await report({ "src/a.ts": `${lines.join("\n")}\n`, "src/b.ts": "// ast-grep-ignore\nconsole.log(4);\n" });
  assert.deepEqual(findings.map((line) => line.split(" ")[0]), ["src/a.ts:2", "src/a.ts:4", "src/a.ts:5", "src/b.ts:2"]);
});

test("a rules folder that cannot be read fails the check instead of passing for one with no rules", async (t) => {
  ownerRules(t, NO_LOG);
  const folder = join(process.env.XDG_CONFIG_HOME!, "coherence", "ast-grep");
  chmodSync(folder, 0o000);
  t.after(() => chmodSync(folder, 0o755));
  await assert.rejects(report(APP), { message: /cannot read the ast-grep rules in .*ast-grep: EACCES/ });
});

test("a rule file that holds two rules is skipped rather than half-tested, and a string holding a suppression word is read as written", async (t) => {
  const written = ownerRules(t, {
    ...NO_ANY,
    "two.yml": `${NO_LOG["no-log.yml"].replace("no-log", "two-a")}--- # a second rule\n${NO_LOG["no-log.yml"].replace("no-log", "two-b").replace("pattern: console.log", "pattern: console.nothing")}`,
    "two.match.ts": "console.log(1);\n",
    "two.clean.ts": "console.error(1);\n",
    "literal.yml": "id: literal\nlanguage: TypeScript\nseverity: error\nmessage: m\nrule: { pattern: 'off(\"ast-grep-ignore\")' }\n",
    "literal.match.ts": 'off("ast-grep-ignore");\n',
    "literal.clean.ts": 'off("other");\n',
  });
  assert.deepEqual(await report({ ...APP, "src/b.ts": 'off("ast-grep-ignore");\n' }), [
    "src/app.ts:1 note say what the type is (ast-grep rule no-any)",
    "src/b.ts:1 must-fix m (ast-grep rule literal)",
  ]);
  assert.match(written.join(""), /two\.yml: it holds more than one rule/);
  // Saved with Windows line endings too: a multiline $ in JavaScript matches before \r as well as \n (measured 2026-11-17).
  ownerRules(t, { ...NO_LOG, "no-log.yml": `${NO_LOG["no-log.yml"]}---\n${NO_LOG["no-log.yml"].replace("no-log", "never").replace("pattern: console.log", "pattern: console.nothing")}`.replaceAll("\n", "\r\n") });
  assert.deepEqual(await report(APP), []);
});
