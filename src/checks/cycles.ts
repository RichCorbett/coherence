import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedTool, runProcess } from "../lib/process.ts";
import { NOT_HAND_WRITTEN, type Repo } from "../lib/repo.ts";

const SCRIPT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];
const SCRIPT_FILE = new RegExp(`\\.(${SCRIPT_EXTENSIONS.join("|")})$`);

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
    const targets = await madgeTargets(repo, files);
    const args = [...MADGE_ARGS, "--basedir", repo.root, "--extensions", SCRIPT_EXTENSIONS.join(","), "--exclude", NOT_HAND_WRITTEN.source, ...targets];
    const result = await runPinnedTool(MADGE, args);
    let cycles: string[][];
    try {
      cycles = JSON.parse(result.stdout);
    } catch {
      throw new Error(`madge failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    // A root scan also reads untracked and ignored files, so keep only cycles made wholly of the files listed above.
    const checked = new Set(files);
    const wanted = targets.length === 1 && targets[0] === repo.root ? cycles.filter((cycle) => cycle.every((path) => checked.has(path))) : cycles;
    // One finding per file, so editing any file of a cycle makes the branch answerable for it.
    return wanted.flatMap((cycle) => {
      const message = `import cycle: ${[...cycle, cycle[0]].join(" -> ")}; make dependencies point one way`;
      return cycle.map((path) => this.finding(path, message));
    });
  }
}

/**
 * What to hand madge: each file, which keeps it off ignored and untracked folders, or the whole repo root
 * when one path per file would pass the system's argument limit. Half the limit is used, as the environment counts against it too.
 */
export async function madgeTargets(repo: Repo, files: string[], budget?: number): Promise<string[]> {
  // The plugin targets POSIX systems, so getconf exists; if it fails, a small budget sends big repos to the root scan, which always fits.
  budget ??= (Number((await runProcess("getconf", ["ARG_MAX"], repo.root).catch(() => undefined))?.stdout) || 262_144) / 2;
  const paths = files.map((path) => repo.absolutePath(path));
  // Each argument also costs its terminating NUL and a pointer.
  return paths.reduce((total, path) => total + path.length + 9, 0) > budget ? [repo.root] : paths;
}
