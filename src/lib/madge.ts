import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runPinnedTool, runProcess, withTempFolder } from "./process.ts";
import { NOT_HAND_WRITTEN } from "./repo.ts";

const SCRIPT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];
export const SCRIPT_FILE = new RegExp(`\\.(${SCRIPT_EXTENSIONS.join("|")})$`);

// madge counts `import type` as an import unless told otherwise, which is what we want:
// a type import still ties two files together for the reader.
const MADGE = "madge/bin/cli.js";

/**
 * madge's JSON answer for `files` under `root`, a repo or an export of one, with `extra` options such as --circular.
 * --basedir makes madge name files relative to `root`. madge exits 1 when it finds cycles, so only a missing JSON answer means it failed.
 */
export async function madge(root: string, files: string[], extra: string[]): Promise<unknown> {
  const targets = await madgeTargets(root, files);
  const result = await withTempFolder(async (folder) => {
    const options = ["--extensions", SCRIPT_EXTENSIONS.join(","), "--exclude", NOT_HAND_WRITTEN.source, ...(await aliasConfig(root, folder))];
    return runPinnedTool(MADGE, ["--json", "--no-spinner", ...extra, "--basedir", root, ...options, ...targets]);
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`madge failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

/**
 * What to hand madge: each file, which keeps it off ignored and untracked folders, or the whole repo root
 * when one path per file would pass the system's argument limit. Half the limit is used, as the environment counts against it too.
 */
export async function madgeTargets(root: string, files: string[], budget?: number): Promise<string[]> {
  // The plugin targets POSIX systems, so getconf exists; if it fails, a small budget sends big repos to the root scan, which always fits.
  budget ??= (Number((await runProcess("getconf", ["ARG_MAX"], root).catch(() => undefined))?.stdout) || 262_144) / 2;
  const paths = files.map((path) => join(root, path));
  // Each argument also costs its terminating NUL and a pointer.
  return paths.reduce((total, path) => total + Buffer.byteLength(path) + 9, 0) > budget ? [root] : paths;
}

// Without the repo's aliases, madge cannot resolve an import through a tsconfig `paths` entry, so a cycle through one goes unreported.
// The repo's own tsconfig is never handed to madge, so its `extends` and other options never apply. madge gets a generated tsconfig
// in a folder of ours, holding only `baseUrl` and the aliases whose targets start inside the repo. This is not a sandbox: madge can still
// read outside the repo through a relative import, or a symlink under a wildcard target (measured 2026-11-11). It parses those files
// for imports only, and the cycle filter above keeps them out of the findings.
// A tsconfig with comments or trailing commas is not plain JSON and is treated as having no aliases.
async function aliasConfig(root: string, folder: string): Promise<string[]> {
  const path = join(root, "tsconfig.json");
  if (!(await lstat(path).catch(() => undefined))?.isFile()) return [];
  let options: { baseUrl?: unknown; paths?: unknown };
  try {
    options = JSON.parse(await readFile(path, "utf8")).compilerOptions ?? {};
  } catch {
    return [];
  }
  const realRoot = await realpath(root);
  const baseUrl = resolve(root, typeof options.baseUrl === "string" ? options.baseUrl : ".");
  if (!(await isInside(realRoot, baseUrl)) || typeof options.paths !== "object" || options.paths === null) return [];
  const paths: Record<string, string[]> = {};
  for (const [alias, targets] of Object.entries(options.paths)) {
    // All or nothing: dropping only some targets could make TypeScript resolve the alias to a different file.
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const inside = await Promise.all(targets.map(async (target) => typeof target === "string" && (await isInside(realRoot, resolve(baseUrl, target)))));
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
