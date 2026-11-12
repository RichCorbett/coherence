import { type ChildProcess, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProcessResult = { code: number; stdout: string; stderr: string };

// Large repos make git and the external tools print a lot; the default buffer would kill them mid-run.
export const MAX_OUTPUT_MB = 64;
const MAX_OUTPUT_BYTES = MAX_OUTPUT_MB * 1024 * 1024;

// Every program runProcess has started and not yet seen exit, so the PR hook can stop them when it runs out of time.
const running = new Set<ChildProcess>();

/** Kills every program runProcess started that is still running. Their calls then fail. */
export function stopRunning(): void {
  for (const child of running) child.kill("SIGKILL");
}

/**
 * Runs a program to completion. A non-zero exit is a result to inspect, not an error.
 * With `timeoutMs`, a program still running after that long is killed and the call fails.
 */
export function runProcess(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8", timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error?.killed && timeoutMs !== undefined) {
        // Only the first argument, which names the subcommand or script; the rest can be thousands of file paths.
        return reject(new Error(`${command} ${args[0] ?? ""} did not finish within ${timeoutMs / 1000}s`));
      }
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
    running.add(child);
    child.on("exit", () => running.delete(child));
    // Nothing feeds these programs, and one that reads stdin would wait forever.
    child.stdin?.end();
  });
}

// The plugin's own tools/package.json and package-lock.json, which pin madge, jscpd and everything they depend on.
const TOOLS_MANIFEST = join(import.meta.dirname, "../../tools");
const TOOL_SCRIPTS = ["madge/bin/cli.js", "jscpd/run-jscpd.js"];
// A cold install measured about 1s on a fast connection. Two minutes allows a slow one,
// and stops a stalled registry connection well before npm's own 5-minute fetch timeout and its retries would.
const NPM_CI_TIMEOUT_MS = 120_000;
// madge and jscpd take about a second on this repo. Five minutes leaves room for a repo hundreds of times larger,
// and still stops a hung tool before it holds up a review indefinitely.
const TOOL_TIMEOUT_MS = 300_000;
let installing: Promise<string> | undefined;

/**
 * Runs `script`, a path inside the tools' node_modules such as `madge/bin/cli.js`, with the node running coherence.
 * The tools are installed on first use, because an installed plugin has no npm install step.
 * It runs from an empty folder because the tools read config files such as .madgerc and .jscpd.json from their working folder,
 * and the repo under review must not be able to supply them.
 */
export async function runPinnedTool(script: string, args: string[]): Promise<ProcessResult> {
  installing ??= installTools().catch((error) => {
    installing = undefined;
    throw error;
  });
  const tools = await installing;
  return withTempFolder((folder) => runProcess(process.execPath, [join(tools, "node_modules", script), ...args], folder, TOOL_TIMEOUT_MS));
}

/**
 * Installs the tools from `manifest` into a cache folder named for the platform and the manifest's hash, once each, and returns that folder.
 * `npm ci --ignore-scripts` installs exactly what the lockfile pins and runs no package's install script.
 * Concurrent first runs each install into their own temp folder and rename it into place, so the folder exists only once
 * an install has completed; a run that loses the rename uses the winner's folder and removes its own.
 * Anything else already at the folder's path is refused, never repaired: deleting it could delete another run's finished install.
 * Nothing checks the installed files further: the cache is in the user's own home, as trusted as the ~/.npm cache npx used before.
 */
export async function installTools(manifest = TOOLS_MANIFEST): Promise<string> {
  const hash = createHash("sha256");
  for (const file of ["package.json", "package-lock.json"]) hash.update(await readFile(join(manifest, file)));
  // The platform too, because npm installs jscpd's native build only for the platform it runs on.
  const name = `tools-${process.platform}-${process.arch}-${hash.digest("hex").slice(0, 16)}`;
  const tools = join(cacheParent(), name);
  if (await lstat(tools).catch(() => undefined)) return usable(tools);

  // A sibling of the final folder, so the rename stays on one file system and is atomic.
  const staging = await makeCacheFolder(`${name}-installing-`);
  try {
    for (const file of ["package.json", "package-lock.json"]) await copyFile(join(manifest, file), join(staging, file));
    // npm takes the folder holding package.json as the project, so the .npmrc it reads is never one from the repo under review.
    // npm is found on PATH, as `node` is when bin/coherence runs, so trusting PATH for it adds no new exposure.
    // The plugin targets POSIX systems (bin/coherence is sh), so Windows' npm.cmd is out of scope.
    const failure = await runProcess("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], staging, NPM_CI_TIMEOUT_MS).then(
      (result) => (result.code === 0 ? undefined : new Error(`installing madge and jscpd failed: ${result.stderr.trim() || result.stdout.trim()}`)),
      (error: Error) => error,
    );
    if (failure) {
      // Another run may have finished the same install meanwhile.
      if (await isInstalled(tools)) return tools;
      throw failure;
    }
    await rename(staging, tools).catch((error) => {
      // macOS reports ENOTEMPTY and Linux EEXIST when another run's install is already in place.
      if (!["ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    });
    // Awaited here, so a refusal settles before the finally block removes the staging folder.
    return await usable(tools);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Returns `tools` if it is a finished install, and otherwise fails, leaving it for the user to delete. */
async function usable(tools: string): Promise<string> {
  if (await isInstalled(tools)) return tools;
  throw new Error(`coherence: the tool cache at ${tools} is incomplete or not a plain folder; delete it and run again`);
}

/** Whether `tools` is a real folder, not a symlink, holding every entry script as a regular file. */
async function isInstalled(tools: string): Promise<boolean> {
  try {
    if (!(await lstat(tools)).isDirectory()) return false;
    for (const script of TOOL_SCRIPTS) if (!(await lstat(join(tools, "node_modules", script))).isFile()) return false;
    return true;
  } catch {
    return false;
  }
}

/** A new private folder in coherence's own cache area, for the caller to remove. */
export async function makeCacheFolder(prefix: string): Promise<string> {
  const parent = cacheParent();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(join(parent, prefix));
}

function cacheParent(): string {
  // Not under the system temp folder, which other users can write to: the installed tools run from here,
  // and a tool resolves its packages through every parent of its own folder.
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "coherence");
}

/**
 * Removes folders made by `makeCacheFolder(prefix)` that were last touched over `maxAgeMs` ago.
 * It matches only its own prefix and only real folders, so nothing else in the cache and nothing a symlink points at is touched.
 * Returns how many it removed and how many it could not.
 */
export async function pruneCacheFolders(prefix: string, maxAgeMs: number): Promise<{ removed: number; failed: number }> {
  const parent = cacheParent();
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const folder = join(parent, entry.name);
    try {
      if (Date.now() - (await stat(folder)).mtimeMs <= maxAgeMs) continue;
      await rm(folder, { recursive: true, force: true });
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}

/** Gives `work` an empty folder and removes it afterwards, however `work` ends. */
export async function withTempFolder<T>(work: (folder: string) => Promise<T>): Promise<T> {
  const folder = await makeCacheFolder("run-");
  try {
    return await work(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
