import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { fallowReport } from "../lib/fallow.ts";
import type { Repo } from "../lib/repo.ts";

type Instance = { file: string; start_line: number; end_line: number };
type Report = { clone_groups: { instances: Instance[] }[] };

// fallow's semantic mode treats names and literals as alike, so code rewritten with other names still matches (#65).
const FALLOW_ARGS = ["dupes", "--mode", "semantic", "--no-fragments"];
const MAX_NAMED = 3;

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
        // At most three others each, so a group of many similar pieces gives one line per piece, not every pair.
        // Never more than the named ones plus one are looked at, so a group of thousands costs one pass.
        const others = instances.slice(0, MAX_NAMED + 1).filter((other) => other !== here).slice(0, MAX_NAMED);
        const named = others.map((other) => `${other.file}:${other.start_line}-${other.end_line}`);
        const more = instances.length - 1 > MAX_NAMED ? ` and ${instances.length - 1 - MAX_NAMED} more` : "";
        const message = `lines ${here.start_line}-${here.end_line} do what ${named.join(", ")}${more} already does under other names; reuse one`;
        return this.finding(here.file, message, { line: here.start_line, key: `like ${others[0].file}` });
      }),
    );
  }
}
