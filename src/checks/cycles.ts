import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runProcess } from "../lib/process.ts";
import { asPathArgument, type Repo } from "../lib/repo.ts";

const SCRIPT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// madge counts `import type` as an import unless told otherwise, which is what we want:
// a type cycle still ties two files together for the reader.
const MADGE = ["--yes", "madge@8.0.0", "--json", "--circular", "--no-spinner"];

export class CyclesCheck extends BaseCheck {
  readonly name = "cycles";

  async run(repo: Repo): Promise<Finding[]> {
    const files = (await repo.sourceFiles()).filter((path) => SCRIPT_FILE.test(path));
    if (files.length === 0) return [];

    // madge exits 1 when it finds cycles, so only a missing JSON answer means it failed.
    const result = await runProcess("npx", [...MADGE, ...files.map(asPathArgument)], repo.root);
    let cycles: string[][];
    try {
      cycles = JSON.parse(result.stdout);
    } catch {
      throw new Error(`madge failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    return cycles.map((cycle) =>
      this.finding(cycle[0], `import cycle: ${[...cycle, cycle[0]].join(" -> ")}; make dependencies point one way`),
    );
  }
}
