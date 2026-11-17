import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { madge, SCRIPT_FILE } from "../lib/madge.ts";
import type { Repo } from "../lib/repo.ts";

export class CyclesCheck extends BaseCheck {
  readonly name = "cycles";

  async run(repo: Repo): Promise<Finding[]> {
    const files = (await repo.sourceFiles()).filter((path) => SCRIPT_FILE.test(path));
    if (files.length === 0) return [];

    const cycles = (await madge(repo.root, files, ["--circular"])) as string[][];

    // Keep only cycles made wholly of the files listed above. madge follows imports wherever they lead: a root scan reads
    // untracked and ignored files, and a relative import or a symlink reaches files outside the repo, none of which are ours to report.
    const checked = new Set(files);
    const wanted = cycles.filter((cycle) => cycle.every((path) => checked.has(path)));
    // One finding per file, so editing any file of a cycle makes the branch answerable for it.
    return wanted.flatMap((cycle) => {
      const message = `import cycle: ${[...cycle, cycle[0]].join(" -> ")}; make dependencies point one way`;
      return cycle.map((path) => this.finding(path, message));
    });
  }
}
