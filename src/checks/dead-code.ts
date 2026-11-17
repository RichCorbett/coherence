import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { fallowReport } from "../lib/fallow.ts";
import type { Repo } from "../lib/repo.ts";

type Unused = { path: string; export_name: string; line?: number };
type Report = { unused_files: { path: string }[]; unused_exports: Unused[]; unused_types: Unused[] };

/**
 * Exports that nothing imports and files that no file imports, found by fallow. An export can be public on purpose and a file can be
 * an entry point fallow cannot see, so it is a note.
 */
export class DeadCodeCheck extends BaseCheck {
  readonly name = "dead-code";
  override readonly tier = "note";

  async run(repo: Repo): Promise<Finding[]> {
    // The copy fallow reads holds only hand-written source files, so every path it names is one of ours. The categories left out,
    // such as dependencies, cycles and duplicates, are other checks' business or say nothing about the code.
    const report = await fallowReport<Report>(repo, ["dead-code"]);
    if (!report) return [];
    const exported = (kind: string, unused: Unused[]) =>
      unused.map(({ path, export_name, line }) => this.finding(path, `${kind} ${export_name} is not imported anywhere; remove it or say why it is public`, { line }));
    return [
      ...report.unused_files.map(({ path }) => this.finding(path, "no file imports this one; remove it or make it an entry point")),
      ...exported("export", report.unused_exports),
      ...exported("type", report.unused_types),
    ];
  }
}
