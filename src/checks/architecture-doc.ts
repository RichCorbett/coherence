import { BaseCheck, type Finding } from "../lib/base-check.ts";
import type { Repo } from "../lib/repo.ts";

const DOC = "ARCHITECTURE.md";

export class ArchitectureDocCheck extends BaseCheck {
  readonly name = "architecture-doc";

  async run(repo: Repo): Promise<Finding[]> {
    if (await repo.exists(DOC)) return [];
    return [this.finding(DOC, "missing; write one that walks a request end to end through the modules", { scope: "repo" })];
  }
}
