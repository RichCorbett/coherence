import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedTool } from "../lib/process.ts";
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

    // madge takes the repo root, not the files: a command line holding one path per file passes the system's argument limit on a large repo.
    // The root brings in untracked and ignored files too, which is why the cycles are filtered below.
    // madge exits 1 when it finds cycles, so only a missing JSON answer means it failed.
    // --basedir makes madge name files relative to the repo root.
    const args = [...MADGE_ARGS, "--basedir", repo.root, "--extensions", SCRIPT_EXTENSIONS.join(","), "--exclude", NOT_HAND_WRITTEN.source, repo.root];
    const result = await runPinnedTool(MADGE, args);
    let cycles: string[][];
    try {
      cycles = JSON.parse(result.stdout);
    } catch {
      throw new Error(`madge failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    // Only cycles made wholly of files the other checks look at, as before madge was given the whole root.
    const checked = new Set(files);
    // One finding per file, so editing any file of a cycle makes the branch answerable for it.
    return cycles.filter((cycle) => cycle.every((path) => checked.has(path))).flatMap((cycle) => {
      const message = `import cycle: ${[...cycle, cycle[0]].join(" -> ")}; make dependencies point one way`;
      return cycle.map((path) => this.finding(path, message));
    });
  }
}
