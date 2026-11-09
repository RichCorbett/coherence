import { parseArgs } from "node:util";
import type { BaseCheck, Finding } from "../lib/base-check.ts";
import { BaseCommand, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";
import { FileSizeCheck } from "../checks/file-size.ts";

const CHECKS: BaseCheck[] = [new FileSizeCheck()];

function describe(finding: Finding): string {
  const place = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  return `${place} [${finding.check}] ${finding.message}`;
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
      const changed = new Set(await repo.changedFiles(values.base));
      findings = findings.filter((finding) => changed.has(finding.path));
    }

    for (const finding of findings) invocation.print(describe(finding));
    invocation.print(findings.length === 0 ? "coherence check: clean" : `coherence check: ${findings.length} finding(s)`);
    return findings.length === 0 ? 0 : 1;
  }
}
