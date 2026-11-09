import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedTool } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

type Side = { name: string; start: number; end: number };
type Clone = { firstFile: Side; secondFile: Side };

// --absolute because jscpd's relative names depend on its own idea of the working folder.
const JSCPD = ["jscpd@5.4.3", "--reporters", "json", "--silent", "--absolute"];

export class DuplicatesCheck extends BaseCheck {
  readonly name = "duplicates";

  async run(repo: Repo): Promise<Finding[]> {
    // Naming the files keeps jscpd off fixtures and node_modules, which only sourceFiles() excludes.
    const files = await repo.sourceFiles();
    if (files.length === 0) return [];

    const clones = await this.findClones(repo, files);
    return clones.flatMap(({ firstFile, secondFile }) => [
      this.describe(repo, firstFile, secondFile),
      this.describe(repo, secondFile, firstFile),
    ]);
  }

  private async findClones(repo: Repo, files: string[]): Promise<Clone[]> {
    const output = await mkdtemp(join(tmpdir(), "coherence-jscpd-"));
    try {
      const result = await runPinnedTool([...JSCPD, "--output", output, ...files.map((path) => repo.absolutePath(path))]);
      if (result.code !== 0) throw new Error(`jscpd failed: ${result.stderr.trim() || result.stdout.trim()}`);
      return JSON.parse(await readFile(join(output, "jscpd-report.json"), "utf8")).duplicates;
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  }

  private describe(repo: Repo, here: Side, other: Side): Finding {
    const otherPath = relative(repo.root, other.name);
    const message = `lines ${here.start}-${here.end} repeat ${otherPath}:${other.start}-${other.end}; share one version`;
    return this.finding(relative(repo.root, here.name), message, { line: here.start });
  }
}
