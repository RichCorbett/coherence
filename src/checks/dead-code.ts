import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedProgram, withTempFolder } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

type Unused = { path: string; export_name: string; line?: number };
type Report = { error?: boolean; message?: string; unused_files: { path: string }[]; unused_exports: Unused[]; unused_types: Unused[] };

// A fresh cache folder and no cache, no telemetry and no update check, so a run leaves nothing behind and asks nothing of the network.
const FALLOW_ARGS = ["dead-code", "--format", "json", "--no-cache", "--quiet"];

/**
 * Exports that nothing imports and files that no file imports, found by fallow. An export can be public on purpose and a file can be
 * an entry point fallow cannot see, so it is a note.
 */
export class DeadCodeCheck extends BaseCheck {
  readonly name = "dead-code";
  override readonly tier = "note";

  async run(repo: Repo): Promise<Finding[]> {
    if ((await repo.sourceFiles()).length === 0) return [];

    // The copy fallow reads holds only hand-written source files, so every path it names is one of ours. The categories left out,
    // such as dependencies, cycles and duplicates, are other checks' business or say nothing about the code.
    const report = await withTempFolder((folder) => fallow(repo, folder));
    const exported = (kind: string, unused: Unused[]) =>
      unused.map(({ path, export_name, line }) => this.finding(path, `${kind} ${export_name} is not imported anywhere; remove it or say why it is public`, { line }));
    return [
      ...report.unused_files.map(({ path }) => this.finding(path, "no file imports this one; remove it or make it an entry point")),
      ...exported("export", report.unused_exports),
      ...exported("type", report.unused_types),
    ];
  }
}

/**
 * fallow's dead-code answer for a copy of the repo's source files, never the repo itself: a repo's own fallow config can extend files
 * outside it, and fallow running git in the repo obeys the repo's .git/config, which ran a planted command under `fallow audit`
 * (measured 2026-11-17). Our own empty config stands in for the repo's. fallow exits 1 when it finds something, so only an answer
 * that is not JSON, or that says it is an error, means it failed.
 */
async function fallow(repo: Repo, folder: string): Promise<Report> {
  const [copy, cache, config] = [join(folder, "copy"), join(folder, "cache"), join(folder, ".fallowrc.json")];
  await mkdir(copy);
  await repo.copySourceFiles(copy);
  await writeFile(config, "{}");
  const env = { FALLOW_TELEMETRY_DISABLED: "1", FALLOW_UPDATE_CHECK: "off", FALLOW_CACHE_DIR: cache };
  const result = await runPinnedProgram("fallow", [...FALLOW_ARGS, "--root", copy, "--config", config], env);
  let report: Report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`fallow failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  if (report.error) throw new Error(`fallow failed: ${report.message}`);
  return report;
}
