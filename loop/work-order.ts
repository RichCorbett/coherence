import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/** What a work-order item may do without asking. Anything else falls through to the usual permission flow. */
const OPS = ["merge_main", "push_main", "close_issue", "eval"] as const;
export type Op = (typeof OPS)[number];

export type Item = {
  issue: number;
  title?: string;
  /** The branch the item is built on, with * for any run of letters, digits, dot, dash or underscore, like feat/66-*. */
  branch: string;
  ops: Op[];
  /** Issues that must be closed before this item starts. */
  after?: number[];
  /** Most `--runs` one `claude plugin eval` call may ask for. */
  evalRunsPerCall?: number;
  /** Most eval calls this item may make. */
  evalCalls?: number;
};

export type WorkOrder = {
  id: string;
  repo: string;
  workdir: string;
  base: string;
  expires: string;
  items: Item[];
  limits?: { stopsWithoutProgress?: number; blocksPerSession?: number };
};

export const DEFAULT_LIMITS = { stopsWithoutProgress: 3, blocksPerSession: 30 };

/** Where the owner keeps the work order, its approval, the installed hooks and their state. The agent may not write here. */
export function loopHome(): string {
  return process.env.COHERENCE_LOOP_HOME ?? join(homedir(), ".config", "coherence-loop");
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The path with a leading ~ expanded and symlinks resolved where it exists. */
export function realPath(path: string): string {
  const expanded = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
  try {
    return realpathSync(expanded);
  } catch {
    return resolve(expanded);
  }
}

export function isInside(path: string, folder: string): boolean {
  const target = realPath(path);
  const root = realPath(folder);
  return target === root || target.startsWith(root + sep);
}

/** The work order with every field it relies on checked, or an error naming the first bad one. */
export function parseWorkOrder(text: string): WorkOrder {
  const order = JSON.parse(text) as WorkOrder;
  const need = (ok: boolean, what: string) => {
    if (!ok) throw new Error(what);
  };
  need(typeof order.id === "string" && order.id !== "", "id must be a non-empty string");
  need(/^[\w.-]+\/[\w.-]+$/.test(order.repo ?? ""), "repo must be owner/name");
  need(typeof order.workdir === "string" && order.workdir !== "", "workdir must be a path");
  need(/^[\w./-]+$/.test(order.base ?? ""), "base must be a branch name");
  need(!Number.isNaN(Date.parse(order.expires)), "expires must be a date");
  need(Array.isArray(order.items) && order.items.length > 0, "items must be a non-empty list");
  const seen = new Set<number>();
  for (const item of order.items) {
    need(Number.isInteger(item.issue) && item.issue > 0 && !seen.has(item.issue), `item issue ${item.issue} must be a unique issue number`);
    seen.add(item.issue);
    need(/^[\w./*-]+$/.test(item.branch ?? ""), `item #${item.issue} needs a branch pattern`);
    need(Array.isArray(item.ops) && item.ops.every((op) => (OPS as readonly string[]).includes(op)), `item #${item.issue} ops must be from ${OPS.join(", ")}`);
    need((item.after ?? []).every((issue) => Number.isInteger(issue)), `item #${item.issue} after must list issue numbers`);
  }
  return order;
}

export type Active = { order: WorkOrder; home: string };

/** The approved, unexpired work order whose workdir holds `cwd`, or why none applies. Any doubt answers "none", so the hooks go quiet. */
export function activeWorkOrder(cwd: string, now = new Date()): Active | string {
  const home = loopHome();
  const file = join(home, "work-order.json");
  const approvalFile = join(home, "approval.json");
  if (!existsSync(file)) return "there is no work order";
  if (!existsSync(approvalFile)) return "the work order is not approved";
  const raw = readFileSync(file);
  let approval: { id?: string; sha256?: string };
  let order: WorkOrder;
  try {
    approval = JSON.parse(readFileSync(approvalFile, "utf8"));
    order = parseWorkOrder(raw.toString("utf8"));
  } catch (error) {
    return `the work order or its approval cannot be read: ${(error as Error).message}`;
  }
  if (approval.sha256 !== sha256(raw) || approval.id !== order.id) return "the work order changed after it was approved";
  if (Date.parse(order.expires) <= now.getTime()) return "the work order has expired";
  if (!isInside(cwd, order.workdir)) return "this folder is outside the work order's workdir";
  return { order, home };
}

/** A small JSON file of the hooks' own, written whole through a rename so a hook killed mid-write leaves the old one. */
export function readState<T>(home: string, name: string, empty: T): T {
  try {
    return JSON.parse(readFileSync(join(home, "state", `${name}.json`), "utf8")) as T;
  } catch {
    return empty;
  }
}

export function writeState(home: string, name: string, value: unknown): void {
  const file = join(home, "state", `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.${process.pid}`, JSON.stringify(value, null, 2));
  renameSync(`${file}.${process.pid}`, file);
}

const ISSUE_CACHE_MS = 60_000;

/** Whether each issue is closed on GitHub, from a one-minute cache unless `fresh`, or from gh. Throws when gh cannot answer. */
function closedIssues(active: Active, issues: number[], now = Date.now(), fresh = false): Map<number, boolean> {
  type Cache = Record<string, { closed: boolean; at: number }>;
  const cache = readState<Cache>(active.home, "issues", {});
  const result = new Map<number, boolean>();
  for (const issue of issues) {
    const key = `${active.order.repo}#${issue}`;
    const hit = cache[key];
    if (hit && now - hit.at < ISSUE_CACHE_MS && !fresh) {
      result.set(issue, hit.closed);
      continue;
    }
    const state = execFileSync("gh", ["api", `repos/${active.order.repo}/issues/${issue}`, "--jq", ".state"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
    if (state !== "open" && state !== "closed") throw new Error(`gh answered "${state}" for issue #${issue}`);
    cache[key] = { closed: state === "closed", at: now };
    result.set(issue, state === "closed");
  }
  writeState(active.home, "issues", cache);
  return result;
}

/** The file where the agent parks an item it cannot finish, one JSON line {"issue": N, "why": "..."} each. Inside .git, so it is never committed. */
export function parkedFile(order: WorkOrder): string {
  return join(realPath(order.workdir), ".git", "work-order-parked.jsonl");
}

function parkedIssues(order: WorkOrder): Map<number, string> {
  const parked = new Map<number, string>();
  let text = "";
  try {
    text = readFileSync(parkedFile(order), "utf8");
  } catch {
    return parked;
  }
  for (const line of text.split("\n")) {
    try {
      const entry = JSON.parse(line) as { issue?: unknown; why?: unknown };
      if (typeof entry.issue === "number") parked.set(entry.issue, String(entry.why ?? ""));
    } catch {
      // A line that is not JSON parks nothing.
    }
  }
  return parked;
}

export type Next = { item: Item; waiting: number } | { item: undefined; waiting: number; parked: Map<number, string> };

/** The first item that is neither closed nor parked and whose `after` issues are all closed. */
export function nextItem(active: Active, now = Date.now(), fresh = false): Next {
  const order = active.order;
  const issues = [...new Set(order.items.flatMap((item) => [item.issue, ...(item.after ?? [])]))];
  const closed = closedIssues(active, issues, now, fresh);
  const parked = parkedIssues(order);
  const open = order.items.filter((item) => !closed.get(item.issue) && !parked.has(item.issue));
  const ready = open.find((item) => (item.after ?? []).every((issue) => closed.get(issue)));
  return ready ? { item: ready, waiting: open.length - 1 } : { item: undefined, waiting: open.length, parked };
}

/** A fingerprint of the workdir's branches and uncommitted changes, so a stop after real work is not counted as a stop without progress. */
export function progressMark(workdir: string): string {
  const run = (args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: realPath(workdir), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
    } catch {
      return "";
    }
  };
  return sha256(run(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]) + run(["status", "--porcelain"]));
}

export function readHookInput<T>(): T {
  return JSON.parse(readFileSync(0, "utf8")) as T;
}
