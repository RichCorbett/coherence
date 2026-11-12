import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedTool, withTempFolder } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

type Side = { name: string; start: number; end: number };
type Clone = { firstFile: Side; secondFile: Side };

// --absolute because jscpd's relative names depend on its own idea of the working folder.
const JSCPD = "jscpd/run-jscpd.js";
const JSCPD_ARGS = ["--reporters", "json", "--silent", "--absolute"];

export class DuplicatesCheck extends BaseCheck {
  readonly name = "duplicates";

  async run(repo: Repo): Promise<Finding[]> {
    // Naming the files keeps jscpd off fixtures and node_modules, which only sourceFiles() excludes.
    // They go in a config file, because a command line holding one path per file passes the system's argument limit on a large repo.
    const files = await repo.sourceFiles();
    if (files.length === 0) return [];

    const clones = await this.findClones(repo, files);
    return clones.flatMap(({ firstFile, secondFile }) => [
      this.describe(repo, firstFile, secondFile),
      this.describe(repo, secondFile, firstFile),
    ]);
  }

  private async findClones(repo: Repo, files: string[]): Promise<Clone[]> {
    return withTempFolder(async (output) => {
      const config = join(output, "jscpd-config.json");
      await writeFile(config, JSON.stringify({ path: files.map((path) => repo.absolutePath(path)) }));
      const result = await runPinnedTool(JSCPD, [...JSCPD_ARGS, "--config", config, "--output", output]);
      if (result.code !== 0) throw new Error(`jscpd failed: ${result.stderr.trim() || result.stdout.trim()}`);
      return JSON.parse(await readFile(join(output, "jscpd-report.json"), "utf8")).duplicates;
    });
  }

  private describe(repo: Repo, here: Side, other: Side): Finding {
    const otherPath = relative(repo.root, other.name);
    const message = `lines ${here.start}-${here.end} repeat ${otherPath}:${other.start}-${other.end}; share one version`;
    return this.finding(relative(repo.root, here.name), message, { line: here.start });
  }
}
