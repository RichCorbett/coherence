import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { Repo } from "../lib/repo.ts";

// The brief format. agents/coder.md and ARCHITECTURE.md carry the same meanings, and a test holds them together.
export const FIELDS = [
  { name: "Idea", meaning: "how the thing works and what it is made of, in a few sentences" },
  { name: "Spine", meaning: "committed paths of the base shapes and worked example to build on, or the surrounding code for a change inside an existing shape" },
  { name: "Slot", meaning: "the one piece this agent builds" },
  { name: "Reuse", meaning: "the existing helpers and libraries to use" },
  { name: "Done", meaning: "the condition that proves it finished" },
];

// A field starts a line; markdown decoration (bullets, headings, bold) may surround its name and colon.
const FIELD_LINE = new RegExp(`^[\\s>#*_\`-]*(${FIELDS.map((field) => field.name).join("|")})[\\s*_\`]*:[\\s*_\`]*(.*)$`, "i");

/** Refuses a coding subagent whose brief has no committed spine to build on, so the shape is set before the code is. */
export class GateCommand extends BaseCommand {
  readonly name = "gate";
  readonly usage = "coherence gate  (PreToolUse hook; reads the hook JSON on stdin)";

  async execute(invocation: Invocation): Promise<number> {
    const hook = JSON.parse(await invocation.readStdin());
    if (!isCoder(hook.tool_input?.subagent_type)) return Exit.ok;

    const problems = await briefProblems(String(hook.tool_input.prompt ?? ""), hook.cwd ?? invocation.cwd);
    if (problems.length === 0) return Exit.ok;

    const format = FIELDS.map((field) => `${field.name} = ${field.meaning}`).join("; ");
    const reason =
      `Brief refused by coherence: ${problems.join("; ")}. ` +
      "Write and commit the spine first (the base shapes and a worked example the new code must build on), " +
      `then brief again with all five fields, each starting a line: ${format}.`;
    this.deny(invocation, reason);
    return Exit.ok;
  }
}

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
      current = FIELDS.find((field) => field.name.toLowerCase() === match[1].toLowerCase())!.name;
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
  const problems = FIELDS.filter(({ name }) => !fields.get(name)?.trim()).map(({ name }) => `the ${name} field is missing or empty`);

  const paths = spinePaths(fields.get("Spine") ?? "");
  if (fields.get("Spine")?.trim() && paths.length === 0) problems.push("the Spine field lists no path");
  const spineProblems = await Promise.all(paths.map((path) => spineProblem(path, cwd)));
  return [...problems, ...spineProblems.filter((problem) => problem !== undefined)];
}
