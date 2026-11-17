import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPinnedProgram, withTempFolder } from "./process.ts";
import type { Repo } from "./repo.ts";

/**
 * fallow's JSON answer to `args`, such as `["dead-code"]`, for a copy of the repo's source files, never the repo itself: a repo's own
 * fallow config can extend files outside it, and fallow running git in the repo obeys the repo's .git/config, which ran a planted
 * command under `fallow audit` (measured 2026-11-17). Our own empty config stands in for the repo's, with a fresh cache folder and no
 * cache, telemetry or update check, so a run leaves nothing behind and asks nothing of the network. fallow exits 1 when it finds
 * something, so only an answer that is not JSON, or that says it is an error, means it failed.
 * A repo with no source files is not handed to fallow, and gets undefined.
 */
export async function fallowReport<T>(repo: Repo, args: string[]): Promise<T | undefined> {
  if ((await repo.sourceFiles()).length === 0) return undefined;
  return withTempFolder(async (folder) => {
    const [copy, cache, config] = [join(folder, "copy"), join(folder, "cache"), join(folder, ".fallowrc.json")];
    await mkdir(copy);
    await repo.copySourceFiles(copy);
    await writeFile(config, "{}");
    const env = { FALLOW_TELEMETRY_DISABLED: "1", FALLOW_UPDATE_CHECK: "off", FALLOW_CACHE_DIR: cache };
    const result = await runPinnedProgram("fallow", [...args, "--format", "json", "--no-cache", "--quiet", "--root", copy, "--config", config], env);
    let report: T & { error?: boolean; message?: string };
    try {
      report = JSON.parse(result.stdout);
    } catch {
      throw new Error(`fallow failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    if (report.error) throw new Error(`fallow failed: ${report.message}`);
    return report;
  });
}
