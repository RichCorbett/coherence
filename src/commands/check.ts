import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { BaseCheck, Finding } from "../lib/base-check.ts";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { saveBaseline, withoutBaseline } from "../lib/baseline.ts";
import { stopRunning } from "../lib/process.ts";
import { Repo } from "../lib/repo.ts";
import { AstGrepCheck } from "../checks/ast-grep.ts";
import { CyclesCheck } from "../checks/cycles.ts";
import { DeadCodeCheck } from "../checks/dead-code.ts";
import { DuplicatesCheck } from "../checks/duplicates.ts";
import { FirstImportCheck } from "../checks/first-import.ts";
import { FlatFolderCheck } from "../checks/flat-folder.ts";

const CHECKS: BaseCheck[] = [
  new CyclesCheck(),
  new DuplicatesCheck(),
  new FlatFolderCheck(),
  new FirstImportCheck(),
  new DeadCodeCheck(),
  new AstGrepCheck(),
];

/** Runs every deterministic rule, so reviewers can spend their attention on judgment. */
export class CheckCommand extends BaseCommand {
  readonly name = "check";
  readonly usage = "coherence check [--base <ref>] | coherence check --save-baseline  (records every finding now, so later checks report only new ones)";

  private readonly checks: BaseCheck[];

  constructor(checks = CHECKS) {
    super();
    this.checks = checks;
  }

  async execute(invocation: Invocation): Promise<number> {
    const { values } = parseArgs({ args: invocation.args, options: { base: { type: "string" }, "save-baseline": { type: "boolean" } } });
    const base = values.base;
    if (values["save-baseline"] && base) throw new Error("--save-baseline records the whole repo, so it takes no --base");
    const repo = await Repo.open(invocation.cwd);

    let findings: Finding[];
    try {
      findings = (await Promise.all(this.checks.map((check) => check.run(repo, base)))).flat();
    } catch (error) {
      // Promise.all returns at the first failure and leaves the other checks' programs running; stop them, since the run has failed.
      stopRunning();
      throw error;
    }
    if (values["save-baseline"]) {
      for (const finding of findings) invocation.print(describe(finding));
      invocation.print(`coherence check: saved ${findings.length} finding(s) as the baseline in ${await saveBaseline(repo, findings)}`);
      return Exit.ok;
    }
    const { fresh, known } = await withoutBaseline(repo, findings);
    findings = fresh;
    if (base) {
      const changed = await repo.changedFiles(base);
      const [before, after] = [await repo.sourceFilesAtBranchPoint(base), await repo.sourceFiles()];
      findings = findings.filter((finding) => isInBranchChange(finding, changed, (folder) => filesIn(after, folder) > filesIn(before, folder)));
    }

    for (const finding of findings) invocation.print(describe(finding));
    // A name like build/ is also an ordinary word for hand-written code, so a clean result must say what it did not read.
    // It is only a note, so a failure to count says so and never fails a check that has finished.
    try {
      const skipped = (await repo.skippedSourceFiles()).length;
      if (skipped > 0) invocation.print(`coherence check: skipped ${skipped} source file(s) under node_modules, vendor, dist, build or fixtures folders`);
    } catch (error) {
      invocation.print(`coherence check: could not count skipped files: ${(error as Error).message}`);
    }
    if (known > 0) invocation.print(`coherence check: ${known} finding(s) left out because the baseline holds them`);
    const mustFix = findings.filter((finding) => finding.tier === "must-fix").length;
    const notes = findings.length - mustFix;
    const noted = notes > 0 ? ` (${notes} note(s))` : "";
    invocation.print(mustFix === 0 ? `coherence check: clean${noted}` : `coherence check: ${mustFix} finding(s) to fix${noted}`);
    return mustFix === 0 ? Exit.ok : Exit.findings;
  }
}

function describe(finding: Finding): string {
  const place = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  return `${place} [${finding.check}] ${finding.tier === "note" ? "note: " : ""}${finding.message}`;
}

function filesIn(paths: string[], folder: string): number {
  return paths.filter((path) => dirname(path) === folder).length;
}

function isInBranchChange(finding: Finding, changed: string[], folderGrew: (folder: string) => boolean): boolean {
  switch (finding.scope) {
    case "file":
      return changed.includes(finding.path);
    case "folder":
      return folderGrew(finding.path);
  }
}
