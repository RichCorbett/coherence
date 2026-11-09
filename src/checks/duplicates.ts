import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runProcess } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

type Side = { name: string; start: number; end: number };
type Clone = { firstFile: Side; secondFile: Side };

const JSCPD = ["--yes", "jscpd@5.4.3", "--reporters", "json", "--silent"];

export class DuplicatesCheck extends BaseCheck {
  readonly name = "duplicates";

  async run(repo: Repo): Promise<Finding[]> {
    // Naming the files keeps jscpd off fixtures and node_modules, which only sourceFiles() excludes.
    const files = await repo.sourceFiles();
    if (files.length === 0) return [];

    const clones = await this.findClones(repo, files);
    return clones.flatMap(({ firstFile, secondFile }) => [
      this.describe(firstFile, secondFile),
      this.describe(secondFile, firstFile),
    ]);
  }

  private async findClones(repo: Repo, files: string[]): Promise<Clone[]> {
    const output = await mkdtemp(join(tmpdir(), "coherence-jscpd-"));
    try {
      const result = await runProcess("npx", [...JSCPD, "--output", output, ...files], repo.root);
      if (result.code !== 0) throw new Error(`jscpd failed: ${result.stderr.trim() || result.stdout.trim()}`);
      return JSON.parse(await readFile(join(output, "jscpd-report.json"), "utf8")).duplicates;
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }

  private describe(here: Side, other: Side): Finding {
    const message = `lines ${here.start}-${here.end} repeat ${other.name}:${other.start}-${other.end}; share one version`;
    return this.finding(here.name, message, here.start);
  }
}
