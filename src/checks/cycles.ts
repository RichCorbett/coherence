import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedTool, withTempFolder } from "../lib/process.ts";
import type { Repo } from "../lib/repo.ts";

const SCRIPT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// madge counts `import type` as an import unless told otherwise, which is what we want:
// a type cycle still ties two files together for the reader.
const MADGE = "madge/bin/cli.js";
const MADGE_ARGS = ["--json", "--circular", "--no-spinner"];

export class CyclesCheck extends BaseCheck {
  readonly name = "cycles";

  async run(repo: Repo): Promise<Finding[]> {
    const files = (await repo.sourceFiles()).filter((path) => SCRIPT_FILE.test(path));
    if (files.length === 0) return [];

    // madge exits 1 when it finds cycles, so only a missing JSON answer means it failed.
    // --basedir makes madge name files relative to the repo root.
    const result = await withTempFolder(async (folder) =>
      runPinnedTool(MADGE, [...MADGE_ARGS, "--basedir", repo.root, ...(await aliasConfig(repo, folder)), ...files.map((path) => repo.absolutePath(path))]),
    );
    let cycles: string[][];
    try {
      cycles = JSON.parse(result.stdout);
    } catch {
      throw new Error(`madge failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    // One finding per file, so editing any file of a cycle makes the branch answerable for it.
    return cycles.flatMap((cycle) => {
      const message = `import cycle: ${[...cycle, cycle[0]].join(" -> ")}; make dependencies point one way`;
      return cycle.map((path) => this.finding(path, message));
    });
  }
}

// Without the repo's aliases, madge cannot resolve an import through a tsconfig `paths` entry, so a cycle through one goes unreported.
// The repo's own tsconfig is never handed to madge: its `extends`, and `paths` targets that are absolute or use `..`, would make madge
// read files outside the repo. Instead madge gets a generated tsconfig in a folder of ours, holding only `baseUrl` and the `paths`
// targets that stay inside the repo. A tsconfig with comments or trailing commas is not plain JSON and is treated as having no aliases.
async function aliasConfig(repo: Repo, folder: string): Promise<string[]> {
  const path = repo.absolutePath("tsconfig.json");
  if (!(await lstat(path).catch(() => undefined))?.isFile()) return [];
  let options: { baseUrl?: unknown; paths?: unknown };
  try {
    options = JSON.parse(await readFile(path, "utf8")).compilerOptions ?? {};
  } catch {
    return [];
  }
  const baseUrl = resolve(repo.root, typeof options.baseUrl === "string" ? options.baseUrl : ".");
  if (!isInside(repo.root, baseUrl) || typeof options.paths !== "object" || options.paths === null) return [];
  const paths: Record<string, string[]> = {};
  for (const [alias, targets] of Object.entries(options.paths)) {
    const inside = Array.isArray(targets) ? targets.filter((target) => typeof target === "string" && isInside(repo.root, resolve(baseUrl, target))) : [];
    if (inside.length > 0) paths[alias] = inside;
  }
  const generated = join(folder, "tsconfig.json");
  await writeFile(generated, JSON.stringify({ compilerOptions: { baseUrl, paths } }));
  return ["--ts-config", generated];
}

function isInside(root: string, path: string): boolean {
  const from = relative(root, path);
  return from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from);
}
