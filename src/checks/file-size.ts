import { BaseCheck, type Finding } from "../lib/base-check.ts";
import type { Repo } from "../lib/repo.ts";

// Past this a reader can no longer hold the whole file in their head.
const MAX_LINES = 300;

export class FileSizeCheck extends BaseCheck {
  readonly name = "file-size";

  async run(repo: Repo): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const path of await repo.sourceFiles()) {
      const lines = (await repo.read(path)).split("\n").length;
      if (lines <= MAX_LINES) continue;
      findings.push(this.finding(path, `${lines} lines, over the limit of ${MAX_LINES}; split it by what it does`));
    }
    return findings;
  }
}
