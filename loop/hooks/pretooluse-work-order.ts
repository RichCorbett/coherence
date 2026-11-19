// PreToolUse hook on Bash, Edit, Write, MultiEdit and NotebookEdit. Two jobs:
// 1. Guard: refuse any edit inside the loop home, and any Bash line that names it or the approve script, so the agent cannot widen,
//    re-approve or switch off its own work order (the lesson of #35 and #66). This holds with or without a work order.
// 2. Allow: approve a Bash line when every command in it is either a step the current work-order item lists (merge into the base,
//    push the base to origin, close this item's issue, a capped eval run) or a read-only or test command, and at least one is such a
//    step. Anything else prints nothing, so the usual permission flow and every other hook (coherence's PR gate included) still
//    decide. A deny from any hook wins over this allow, and so do settings.json deny rules.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { shellCommands } from "../../src/lib/shell-commands.ts";
import { activeWorkOrder, isInside, type Item, loopHome, nextItem, type Op, readHookInput, readState, realPath, type WorkOrder, writeState } from "../work-order.ts";

type ToolInput = { command?: unknown; file_path?: unknown; notebook_path?: unknown };
type PreToolInput = { session_id?: string; cwd?: string; tool_name?: string; tool_input?: ToolInput };
type Answer = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow" | "deny"; permissionDecisionReason: string } };

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function answer(permissionDecision: "allow" | "deny", permissionDecisionReason: string): Answer {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } };
}

/** Why this tool call touches the loop home, or undefined when it does not. */
export function guarded(input: PreToolInput): string | undefined {
  const home = loopHome();
  const cwd = input.cwd ?? process.cwd();
  if (EDITS.has(input.tool_name ?? "")) {
    const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (typeof path === "string" && isInside(resolve(cwd, path), home)) return "edits the work order, its approval or the hooks that enforce it";
    return undefined;
  }
  const command = input.tool_input?.command;
  if (input.tool_name !== "Bash" || typeof command !== "string") return undefined;
  const names = [home, realPath(home), "coherence-loop", "loop/approve.ts", "work-order.json", "approval.json"];
  return names.some((name) => command.includes(name)) ? "names the work order, its approval or the hooks that enforce it" : undefined;
}

type Git = { dir: string; args: string[] };

/** A git command's folder and its arguments after the global options, or undefined for any global option but -C inside the workdir and -c push.negotiate=true. */
function gitCommand(words: string[], cwd: string, order: WorkOrder): Git | undefined {
  if (words[0] !== "git") return undefined;
  let dir = cwd;
  let at = 1;
  while (at < words.length && words[at].startsWith("-")) {
    if (words[at] === "-C" && words[at + 1] !== undefined) dir = resolve(dir, words[at + 1]);
    else if (words[at] === "-c" && words[at + 1] === "push.negotiate=true") {
      // The push form the remote sessions use.
    } else return undefined;
    at += 2;
  }
  return isInside(dir, order.workdir) ? { dir, args: words.slice(at) } : undefined;
}

function gitOutput(dir: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    return "";
  }
}

function branchPattern(glob: string): RegExp {
  return new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\w.-]*")}$`);
}

/** Takes a flag and its value out of `rest` and returns the value, or undefined when absent. */
function takeValue(rest: string[], ...names: string[]): string | undefined {
  const at = rest.findIndex((word) => names.includes(word));
  if (at === -1) return undefined;
  const [, value] = rest.splice(at, 2);
  return value ?? "";
}

function takeFlags(rest: string[], ...names: string[]): void {
  for (let at = rest.length - 1; at >= 0; at--) if (names.includes(rest[at])) rest.splice(at, 1);
}

/** Which listed step of `item` this one command is, if it is exactly one. */
export function stepOf(words: string[], item: Item, order: WorkOrder, cwd: string): Op | undefined {
  const git = gitCommand(words, cwd, order);
  if (git && git.args[0] === "merge" && item.ops.includes("merge_main")) {
    const rest = git.args.slice(1);
    takeValue(rest, "-m");
    takeFlags(rest, "--no-ff", "--ff-only", "--no-edit", "-q", "--quiet");
    const onBase = gitOutput(git.dir, ["rev-parse", "--abbrev-ref", "HEAD"]) === order.base;
    if (rest.length === 1 && branchPattern(item.branch).test(rest[0]) && onBase) return "merge_main";
  }
  if (git && git.args[0] === "push" && item.ops.includes("push_main")) {
    const rest = git.args.slice(1);
    takeFlags(rest, "-u", "--set-upstream", "-q", "--quiet");
    const origin = gitOutput(git.dir, ["remote", "get-url", "origin"]).toLowerCase();
    const ours = origin.replace(/\.git$/, "").endsWith(order.repo.toLowerCase());
    if (rest.length === 2 && rest[0] === "origin" && rest[1] === order.base && ours) return "push_main";
  }
  if (words[0] === "gh" && words[1] === "issue" && words[2] === "close" && item.ops.includes("close_issue")) {
    const rest = words.slice(3);
    const repo = takeValue(rest, "-R", "--repo");
    takeValue(rest, "-c", "--comment");
    const reason = takeValue(rest, "-r", "--reason");
    const sameRepo = repo === undefined || repo.toLowerCase() === order.repo.toLowerCase();
    if (rest.length === 1 && rest[0].replace(/^#/, "") === String(item.issue) && sameRepo && (reason === undefined || reason === "completed")) return "close_issue";
  }
  if (words[0] === "claude" && words[1] === "plugin" && words[2] === "eval" && item.ops.includes("eval")) {
    const runs = Number(words[words.indexOf("--runs") + 1]);
    const limit = item.evalRunsPerCall ?? 1;
    if (words.includes("--runs") && Number.isInteger(runs) && runs >= 1 && runs <= limit && words.includes("--no-publish")) return "eval";
  }
  return undefined;
}

const READ_ONLY_GIT = new Set(["status", "log", "diff", "show", "rev-parse"]);

/** A command that reads, or runs the repo's own tests, and so may ride along with a listed step. */
export function isRoutine(words: string[], order: WorkOrder, cwd: string): boolean {
  const git = gitCommand(words, cwd, order);
  if (git) return READ_ONLY_GIT.has(git.args[0]) || (git.args[0] === "branch" && git.args[1] === "--show-current" && git.args.length === 2);
  if (words[0] === "cd") return words.length === 2 && isInside(resolve(cwd, words[1]), order.workdir);
  if (words[0] === "npm") return (words.length === 2 && words[1] === "test") || (words.length === 3 && words[1] === "run" && ["test", "typecheck", "check"].includes(words[2]));
  return false;
}

function decide(input: PreToolInput, now = Date.now()): Answer | undefined {
  const touches = guarded(input);
  if (touches) return answer("deny", `This ${touches}. Only Rich changes those, in his own terminal. Carry on with your work, or file a request with dcider-ask.`);
  const command = input.tool_input?.command;
  if (input.tool_name !== "Bash" || typeof command !== "string") return undefined;

  const cwd = input.cwd ?? process.cwd();
  const active = activeWorkOrder(cwd, new Date(now));
  if (typeof active === "string") return undefined;
  let item: Item | undefined;
  try {
    item = nextItem(active, now).item;
  } catch {
    return undefined;
  }
  if (!item) return undefined;

  const steps: Op[] = [];
  // shellCommands also reads the words after any "eval" as a command of their own, as the shell's eval would run them. For
  // `claude plugin eval` that tail is the eval's own arguments, so it is skipped once the eval itself has been judged a step.
  const evalTails = new Set<string>();
  for (const words of shellCommands(command)) {
    if (evalTails.has(JSON.stringify(words))) continue;
    const step = stepOf(words, item, active.order, cwd);
    if (step === "eval") evalTails.add(JSON.stringify(words.slice(words.indexOf("eval") + 1)));
    if (step) steps.push(step);
    else if (!isRoutine(words, active.order, cwd)) return undefined;
  }
  if (steps.length === 0) return undefined;

  if (steps.includes("eval")) {
    const calls = readState<Record<string, number>>(active.home, "evals", {});
    const key = `${active.order.id}#${item.issue}`;
    const used = calls[key] ?? 0;
    if (used >= (item.evalCalls ?? 1)) return undefined;
    calls[key] = used + steps.filter((step) => step === "eval").length;
    writeState(active.home, "evals", calls);
  }
  return answer("allow", `Work order ${active.order.id}, issue #${item.issue}: ${[...new Set(steps)].join(", ")} is approved for this item.`);
}

if (import.meta.main) {
  const result = decide(readHookInput<PreToolInput>());
  if (result) console.log(JSON.stringify(result));
}
