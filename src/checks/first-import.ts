import { dirname } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { madge, SCRIPT_FILE } from "../lib/madge.ts";
import { withTempFolder } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

type Graph = Record<string, string[]>;

/**
 * The first import from one folder into another, against the branch point: the code already shows its own layers, so a new
 * direction between them is worth a look with no layer config. Only folders that held source files at the branch point count,
 * since every import out of a new folder would otherwise be a first. Sometimes the new direction is right, so it is a note.
 */
export class FirstImportCheck extends BaseCheck {
  readonly name = "first-import";
  override readonly tier = "note";

  async run(repo: Repo, base?: string): Promise<Finding[]> {
    if (!base) return [];
    const files = (await repo.sourceFiles()).filter((path) => SCRIPT_FILE.test(path));
    const before = (await repo.sourceFilesAtBranchPoint(base)).filter((path) => SCRIPT_FILE.test(path));
    if (files.length === 0 || before.length === 0) return [];

    const now = (await madge(repo.root, files, [])) as Graph;
    // The base is read from an export of the branch point, never a checkout, so nothing in the working tree changes (docs/adr/0003).
    const then = await withTempFolder(async (folder) => (madge(await repo.exportBranchPoint(base, folder), before, [])) as Promise<Graph>);

    const oldFolders = new Set(before.map(dirname));
    const known = new Set(edges(then, new Set(before)).map(([, , edge]) => edge));
    return edges(now, new Set(files))
      .filter(([from, to, edge]) => !known.has(edge) && oldFolders.has(dirname(from)) && oldFolders.has(dirname(to)))
      .map(([from, to]) =>
        this.finding(from, `first import from ${dirname(from)}/ into ${dirname(to)}/ (${to}); check the layers should depend this way`),
      );
  }
}

/** Each import between two listed files in different folders, as importer, imported and the folder pair. */
function edges(graph: Graph, listed: Set<string>): [string, string, string][] {
  return Object.entries(graph).flatMap(([from, imports]) =>
    !listed.has(from)
      ? []
      : imports
          .filter((to) => listed.has(to) && dirname(to) !== dirname(from))
          .map((to): [string, string, string] => [from, to, JSON.stringify([dirname(from), dirname(to)])]),
  );
}
