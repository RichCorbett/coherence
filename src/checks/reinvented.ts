import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { fallowReport } from "../lib/fallow.ts";
import type { Repo } from "../lib/repo.ts";

type Instance = { file: string; start_line: number; end_line: number };
type Report = { clone_groups: { instances: Instance[] }[] };

// fallow's semantic mode treats names and literals as alike, so code rewritten with other names still matches (#65).
const FALLOW_ARGS = ["dupes", "--mode", "semantic", "--no-fragments"];

/**
 * Code that does what other code already does under other names, found by fallow. Similar things built the same way on purpose,
 * such as two commands in one shape, match too, so it is a note. An exact copy is also a duplicates finding.
 */
export class ReinventedCheck extends BaseCheck {
  readonly name = "reinvented";
  override readonly tier = "note";

  async run(repo: Repo): Promise<Finding[]> {
    const groups = (await fallowReport<Report>(repo, FALLOW_ARGS))?.clone_groups ?? [];
    return groups.flatMap(({ instances }) =>
      instances.map((here) => {
        const others = instances.filter((other) => other !== here).map((other) => `${other.file}:${other.start_line}-${other.end_line}`);
        const message = `lines ${here.start_line}-${here.end_line} do what ${others.join(", ")} already does under other names; reuse one`;
        return this.finding(here.file, message, { line: here.start_line, key: `like ${others.map((other) => other.split(":")[0]).join(", ")}` });
      }),
    );
  }
}
