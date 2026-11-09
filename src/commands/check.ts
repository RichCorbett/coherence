import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { BaseCheck, Finding } from "../lib/base-check.ts";
import { BaseCommand, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";
import { ArchitectureDocCheck } from "../checks/architecture-doc.ts";
import { CyclesCheck } from "../checks/cycles.ts";
import { DuplicatesCheck } from "../checks/duplicates.ts";
import { FileSizeCheck } from "../checks/file-size.ts";
import { FlatFolderCheck } from "../checks/flat-folder.ts";

const CHECKS: BaseCheck[] = [
  new FileSizeCheck(),
  new CyclesCheck(),
  new DuplicatesCheck(),
  new FlatFolderCheck(),
  new ArchitectureDocCheck(),
];

function describe(finding: Finding): string {
  const place = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  return `${place} [${finding.check}] ${finding.message}`;
}

// A finding about a folder belongs to the branch when it changed a file directly inside;
// one about a file that does not exist (a missing document) cannot be changed, so it always stays.
async function isInBranchChange(repo: Repo, finding: Finding, changed: string[]): Promise<boolean> {
  if (changed.includes(finding.path)) return true;
  if (changed.some((path) => dirname(path) === finding.path)) return true;
  return !(await repo.exists(finding.path));
}

/** Runs every deterministic rule, so reviewers can spend their attention on judgment. */
export class CheckCommand extends BaseCommand {
  readonly name = "check";
  readonly usage = "coherence check [--base <ref>]";

  async execute(invocation: Invocation): Promise<number> {
    const { values } = parseArgs({ args: invocation.args, options: { base: { type: "string" } } });
    const repo = await Repo.open(invocation.cwd);

    let findings = (await Promise.all(CHECKS.map((check) => check.run(repo)))).flat();
    if (values.base) {
      const changed = await repo.changedFiles(values.base);
      const touched = await Promise.all(findings.map((finding) => isInBranchChange(repo, finding, changed)));
      findings = findings.filter((_, index) => touched[index]);
    }

    for (const finding of findings) invocation.print(describe(finding));
    invocation.print(findings.length === 0 ? "coherence check: clean" : `coherence check: ${findings.length} finding(s)`);
    return findings.length === 0 ? 0 : 1;
  }
}
