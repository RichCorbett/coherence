import { dirname } from "node:path";
import type { BaseCheck, Finding } from "../lib/base-check.ts";
import { BaseCommand, Exit, openReviewTarget, type Invocation } from "../lib/base-command.ts";
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

/** Runs every deterministic rule, so reviewers can spend their attention on judgment. */
export class CheckCommand extends BaseCommand {
  readonly name = "check";
  readonly usage = "coherence check [--base <ref>]";

  async execute(invocation: Invocation): Promise<number> {
    const { repo, base } = await openReviewTarget(invocation);

    let findings = (await Promise.all(CHECKS.map((check) => check.run(repo)))).flat();
    if (base) {
      const changed = await repo.changedFiles(base);
      findings = findings.filter((finding) => isInBranchChange(finding, changed));
    }

    for (const finding of findings) invocation.print(describe(finding));
    invocation.print(findings.length === 0 ? "coherence check: clean" : `coherence check: ${findings.length} finding(s)`);
    return findings.length === 0 ? Exit.ok : Exit.findings;
  }
}

function describe(finding: Finding): string {
  const place = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  return `${place} [${finding.check}] ${finding.message}`;
}

// A repo-wide finding (a missing document) has no file the branch could have changed, so it always stays.
function isInBranchChange(finding: Finding, changed: string[]): boolean {
  switch (finding.scope) {
    case "file":
      return changed.includes(finding.path);
    case "folder":
      return changed.some((path) => dirname(path) === finding.path);
    case "repo":
      return true;
  }
}
