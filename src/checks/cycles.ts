import { lstat } from "node:fs/promises";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedTool } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

const SCRIPT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// madge counts `import type` as an import unless told otherwise, which is what we want:
// a type cycle still ties two files together for the reader.
const MADGE = "madge/bin/cli.js";
const MADGE_ARGS = ["--json", "--circular", "--no-spinner"];

export class CyclesCheck extends BaseCheck {
  readonly name = "cycles";

  async run(repo: Repo): Promise<Finding[]> {
    const files = (await repo.sourceFiles()).filter((path) => SCRIPT_FILE.test(path));
    if (files.length === 0) return [];

    // madge exits 1 when it finds cycles, so only a missing JSON answer means it failed.
    // --basedir makes madge name files relative to the repo root.
    const tsConfig = await rootTsConfig(repo);
    const result = await runPinnedTool(MADGE, [...MADGE_ARGS, "--basedir", repo.root, ...tsConfig, ...files.map((path) => repo.absolutePath(path))]);
    let cycles: string[][];
    try {
      cycles = JSON.parse(result.stdout);
    } catch {
      throw new Error(`madge failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    // One finding per file, so editing any file of a cycle makes the branch answerable for it.
    return cycles.flatMap((cycle) => {
      const message = `import cycle: ${[...cycle, cycle[0]].join(" -> ")}; make dependencies point one way`;
      return cycle.map((path) => this.finding(path, message));
    });
  }
}

// Without the repo's tsconfig, madge cannot resolve an import through a `paths` alias, so a cycle through one goes unreported.
// The file is data to madge, never code, but it comes from the repo under review: it can still name an `extends` file or alias
// targets outside the repo, which madge would then read and follow. Only a plain file is passed, so a symlink cannot point madge elsewhere.
async function rootTsConfig(repo: Repo): Promise<string[]> {
  const path = repo.absolutePath("tsconfig.json");
  const info = await lstat(path).catch(() => undefined);
  return info?.isFile() ? ["--ts-config", path] : [];
}
