import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { BaseCheck, type Finding, type Tier } from "../lib/base-check.ts";
import { ownerFile } from "../lib/owner-state.ts";
import { runPinnedProgram, withTempFolder } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

type Match = { file: string; ruleId: string; severity: string; message: string; text: string; range: { start: { line: number } } };

// ast-grep skips hidden folders and files its ignore files name. The copy it reads holds none of the repo's ignore files,
// but a source file in a dot-folder is still the repo's code, and an ignore file above the cache folder is not the repo's to apply.
const READ_EVERYTHING = ["hidden", "dot", "exclude", "global", "parent", "vcs"].flatMap((kind) => ["--no-ignore", kind]);

/**
 * The owner's own mechanical rules, written for ast-grep. Each is `<name>.yml` in the owner's `ast-grep` config folder, beside two
 * examples: `<name>.match.<ext>`, which it must report, and `<name>.clean.<ext>`, which it must not. A rule whose examples fail is
 * skipped, and says so on stderr, so a rule that can never match, or that matches everything, never decides a review.
 * A rule's ast-grep severity sets its tier: `error` is must-fix and every other level is a note.
 */
export class AstGrepCheck extends BaseCheck {
  readonly name = "ast-grep";

  async run(repo: Repo): Promise<Finding[]> {
    const rules = await ownerRules();
    if (rules.length === 0 || (await repo.sourceFiles()).length === 0) return [];
    const matches = await withTempFolder(async (folder) => {
      const [copy, config] = [join(folder, "copy"), join(folder, "sgconfig.yml")];
      // Our own config, so ast-grep never looks for one: a repo's sgconfig.yml can load rules from anywhere (measured 2026-11-17).
      await writeFile(config, "ruleDirs: []\n");
      await mkdir(copy);
      await repo.copySourceFiles(copy);
      const found: Match[] = [];
      for (const rule of rules) {
        const failure = await examplesFail(rule, config);
        if (failure) process.stderr.write(`coherence check: skipped the ast-grep rule ${rule.file}: ${failure}\n`);
        else found.push(...(await scan(rule.file, config, [copy])).map((match) => ({ ...match, file: relative(copy, match.file) })));
      }
      return found;
    });
    return matches.map((match) => {
      const tier: Tier = match.severity === "error" ? "must-fix" : "note";
      const finding = this.finding(match.file, `${match.message} (ast-grep rule ${match.ruleId})`, { line: match.range.start.line + 1, key: `${match.ruleId}: ${match.text}` });
      return { ...finding, tier };
    });
  }
}

type Rule = { file: string; match?: string; clean?: string };

/** The owner's rule files with their examples, read from the owner's config folder, never the repo (docs/adr/0002). */
async function ownerRules(): Promise<Rule[]> {
  const folder = ownerFile("ast-grep");
  const names = (await readdir(folder).catch(() => [])).sort();
  return names
    .filter((name) => name.endsWith(".yml"))
    .map((name) => {
      const stem = name.slice(0, -".yml".length);
      const example = (kind: string) => names.find((other) => other.startsWith(`${stem}.${kind}.`));
      const [match, clean] = [example("match"), example("clean")];
      return { file: join(folder, name), match: match && join(folder, match), clean: clean && join(folder, clean) };
    });
}

/** Why `rule` may not run, or undefined when it reports its match example and leaves its clean one alone. */
async function examplesFail(rule: Rule, config: string): Promise<string | undefined> {
  if (!rule.match || !rule.clean) return "it needs a .match. and a .clean. example beside it";
  try {
    if ((await scan(rule.file, config, [rule.match])).length === 0) return "it does not report its match example";
    if ((await scan(rule.file, config, [rule.clean])).length > 0) return "it reports its clean example";
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
}

/** What one rule reports in `paths`. ast-grep exits 1 when it reports an error-level match, so only an answer that is not JSON means it failed. */
async function scan(rule: string, config: string, paths: string[]): Promise<Match[]> {
  const result = await runPinnedProgram("ast-grep", ["scan", "--config", config, "--rule", rule, "--json=compact", ...READ_EVERYTHING, ...paths]);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`ast-grep failed: ${result.stderr.trim().split("\n")[0] || result.stdout.trim()}`);
  }
}
