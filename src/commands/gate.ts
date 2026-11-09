import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { BaseCommand, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";

const FIELDS = ["Idea", "Spine", "Slot", "Reuse", "Done"];

// A field starts a line; markdown decoration (bullets, headings, bold) may surround its name and colon.
const FIELD_LINE = new RegExp(`^[\\s>#*_\`-]*(${FIELDS.join("|")})[\\s*_\`]*:[\\s*_\`]*(.*)$`, "i");

function isCoder(subagentType: unknown): boolean {
  return typeof subagentType === "string" && (subagentType === "coder" || subagentType.endsWith(":coder"));
}

/** Each field's text, which runs from its line until the next field. Fields that are absent are absent from the map. */
function readFields(brief: string): Map<string, string> {
  const fields = new Map<string, string>();
  let current: string | undefined;
  for (const line of brief.split("\n")) {
    const match = FIELD_LINE.exec(line);
    if (match) {
      current = FIELDS.find((field) => field.toLowerCase() === match[1].toLowerCase())!;
      fields.set(current, match[2]);
    } else if (current) {
      fields.set(current, `${fields.get(current)}\n${line}`);
    }
  }
  return fields;
}

function spinePaths(spine: string): string[] {
  return spine
    .split(/[,\s]+/)
    .map((token) => token.replace(/^[`'"]+|[`'",;.]+$/g, ""))
    .filter((token) => token !== "" && token !== "-" && token !== "*");
}

/** Why a spine path cannot serve as the shape to build on, or undefined when it can. */
async function spineProblem(path: string, cwd: string): Promise<string | undefined> {
  const absolute = resolve(cwd, path);
  if (!existsSync(absolute)) return `spine path ${path} does not exist`;
  const real = realpathSync(absolute);
  // The target repo can differ from the session's, so the path's own folder decides which repo to ask.
  const repo = await Repo.open(dirname(real)).catch(() => undefined);
  if (!repo) return `spine path ${path} is not in a git repository`;
  if (!(await repo.isCommitted(relative(repo.root, real)))) return `spine path ${path} is not committed, or has local changes`;
  return undefined;
}

async function briefProblems(brief: string, cwd: string): Promise<string[]> {
  const fields = readFields(brief);
  const problems = FIELDS.filter((field) => !fields.get(field)?.trim()).map((field) => `the ${field} field is missing or empty`);

  const paths = spinePaths(fields.get("Spine") ?? "");
  if (fields.get("Spine")?.trim() && paths.length === 0) problems.push("the Spine field lists no path");
  const spineProblems = await Promise.all(paths.map((path) => spineProblem(path, cwd)));
  return [...problems, ...spineProblems.filter((problem) => problem !== undefined)];
}

/** Refuses a coding subagent whose brief has no committed spine to build on, so the shape is set before the code is. */
export class GateCommand extends BaseCommand {
  readonly name = "gate";
  readonly usage = "coherence gate  (PreToolUse hook; reads the hook JSON on stdin)";

  async execute(invocation: Invocation): Promise<number> {
    const hook = JSON.parse(await invocation.readStdin());
    if (!isCoder(hook.tool_input?.subagent_type)) return 0;

    const problems = await briefProblems(String(hook.tool_input.prompt ?? ""), hook.cwd ?? invocation.cwd);
    if (problems.length === 0) return 0;

    const reason =
      `Brief refused by coherence: ${problems.join("; ")}. ` +
      "Write and commit the spine first (the base shapes and a worked example the new code must build on), " +
      "then brief again with all five fields, each starting a line: Idea, Spine (committed paths), Slot, Reuse, Done.";
    invocation.print(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
    );
    return 0;
  }
}
