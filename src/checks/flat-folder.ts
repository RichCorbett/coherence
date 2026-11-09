import { dirname } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import type { Repo } from "../lib/repo.ts";

// Past this the folder tree has stopped saying how the code is organized.
const MAX_FILES = 15;

export class FlatFolderCheck extends BaseCheck {
  readonly name = "flat-folder";

  async run(repo: Repo): Promise<Finding[]> {
    const counts = new Map<string, number>();
    for (const path of await repo.sourceFiles()) {
      counts.set(dirname(path), (counts.get(dirname(path)) ?? 0) + 1);
    }

    return [...counts]
      .filter(([, count]) => count > MAX_FILES)
      .map(([folder, count]) =>
        this.finding(folder, `${count} source files directly inside, over the limit of ${MAX_FILES}; group them into folders by what they do`),
      );
  }
}
