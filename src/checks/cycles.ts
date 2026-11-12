import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BaseCheck, type Finding } from "../lib/base-check.ts";
import { runPinnedTool, runProcess, withTempFolder } from "../lib/process.ts";
import { NOT_HAND_WRITTEN, type Repo } from "../lib/repo.ts";

const SCRIPT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];
const SCRIPT_FILE = new RegExp(`\\.(${SCRIPT_EXTENSIONS.join("|")})$`);

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
    const targets = await madgeTargets(repo, files);
    const result = await withTempFolder(async (folder) => {
      const options = ["--extensions", SCRIPT_EXTENSIONS.join(","), "--exclude", NOT_HAND_WRITTEN.source, ...(await aliasConfig(repo, folder))];
      return runPinnedTool(MADGE, [...MADGE_ARGS, "--basedir", repo.root, ...options, ...targets]);
    });
    let cycles: string[][];
    try {
      cycles = JSON.parse(result.stdout);
    } catch {
      throw new Error(`madge failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    // A root scan also reads untracked and ignored files, so keep only cycles made wholly of the files listed above.
    const checked = new Set(files);
    const wanted = targets.length === 1 && targets[0] === repo.root ? cycles.filter((cycle) => cycle.every((path) => checked.has(path))) : cycles;
    // One finding per file, so editing any file of a cycle makes the branch answerable for it.
    return wanted.flatMap((cycle) => {
      const message = `import cycle: ${[...cycle, cycle[0]].join(" -> ")}; make dependencies point one way`;
      return cycle.map((path) => this.finding(path, message));
    });
  }
}

/**
 * What to hand madge: each file, which keeps it off ignored and untracked folders, or the whole repo root
 * when one path per file would pass the system's argument limit. Half the limit is used, as the environment counts against it too.
 */
export async function madgeTargets(repo: Repo, files: string[], budget?: number): Promise<string[]> {
  // The plugin targets POSIX systems, so getconf exists; if it fails, a small budget sends big repos to the root scan, which always fits.
  budget ??= (Number((await runProcess("getconf", ["ARG_MAX"], repo.root).catch(() => undefined))?.stdout) || 262_144) / 2;
  const paths = files.map((path) => repo.absolutePath(path));
  // Each argument also costs its terminating NUL and a pointer.
  return paths.reduce((total, path) => total + Buffer.byteLength(path) + 9, 0) > budget ? [repo.root] : paths;
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
  const root = await realpath(repo.root);
  const baseUrl = resolve(repo.root, typeof options.baseUrl === "string" ? options.baseUrl : ".");
  if (!(await isInside(root, baseUrl)) || typeof options.paths !== "object" || options.paths === null) return [];
  const paths: Record<string, string[]> = {};
  for (const [alias, targets] of Object.entries(options.paths)) {
    // All or nothing: dropping only some targets could make TypeScript resolve the alias to a different file.
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const inside = await Promise.all(targets.map(async (target) => typeof target === "string" && (await isInside(root, resolve(baseUrl, target)))));
    if (inside.every(Boolean)) paths[alias] = targets;
  }
  const generated = join(folder, "tsconfig.json");
  await writeFile(generated, JSON.stringify({ compilerOptions: { baseUrl, paths } }));
  return ["--ts-config", generated];
}

/** Whether `path`, with symlinks resolved, is inside `root`, which must already be a real path. Only the part before a `*` is real, and the part that does not exist yet cannot lead anywhere. */
async function isInside(root: string, path: string): Promise<boolean> {
  let existing = path.split("*")[0];
  for (;;) {
    try {
      const from = relative(root, await realpath(existing));
      return from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }
  }
}
