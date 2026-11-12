import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { BaseCheck, Finding } from "../lib/base-check.ts";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";
import { CyclesCheck } from "../checks/cycles.ts";
import { DuplicatesCheck } from "../checks/duplicates.ts";
import { FlatFolderCheck } from "../checks/flat-folder.ts";

const CHECKS: BaseCheck[] = [
  new CyclesCheck(),
  new DuplicatesCheck(),
  new FlatFolderCheck(),
];

/** Runs every deterministic rule, so reviewers can spend their attention on judgment. */
export class CheckCommand extends BaseCommand {
  readonly name = "check";
  readonly usage = "coherence check [--base <ref>]";

  async execute(invocation: Invocation): Promise<number> {
    const { values } = parseArgs({ args: invocation.args, options: { base: { type: "string" } } });
    const base = values.base;
    const repo = await Repo.open(invocation.cwd);

    let findings = (await Promise.all(CHECKS.map((check) => check.run(repo)))).flat();
    if (base) {
      const changed = await repo.changedFiles(base);
      findings = findings.filter((finding) => isInBranchChange(finding, changed));
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
    invocation.print(findings.length === 0 ? "coherence check: clean" : `coherence check: ${findings.length} finding(s)`);
    return findings.length === 0 ? Exit.ok : Exit.findings;
  }
}

function describe(finding: Finding): string {
  const place = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  return `${place} [${finding.check}] ${finding.message}`;
}

function isInBranchChange(finding: Finding, changed: string[]): boolean {
  switch (finding.scope) {
    case "file":
      return changed.includes(finding.path);
    case "folder":
      return changed.some((path) => dirname(path) === finding.path);
  }
}
