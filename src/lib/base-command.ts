import { parseArgs } from "node:util";
import { Repo } from "./repo.ts";

/** What a command's exit code means. `unavailable` is relied on by skills/review/SKILL.md: a reader that is not installed. */
export const Exit = { ok: 0, findings: 1, usage: 2, unavailable: 3, failed: 4 } as const;

export type Invocation = {
  args: string[];
  cwd: string;
  readStdin: () => Promise<string>;
  print: (text: string) => void;
  printError: (text: string) => void;
};

/** One thing `coherence` can do. Adding a command means adding one file in `commands/`. */
export abstract class BaseCommand {
  abstract readonly name: string;
  abstract readonly usage: string;

  /** Returns the process exit code, one of `Exit`. */
  abstract execute(invocation: Invocation): Promise<number>;

  /** Answers a PreToolUse hook by refusing the tool call and telling the agent why. */
  protected deny(invocation: Invocation, reason: string): void {
    invocation.print(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
    );
  }
}

/** The repo to review and, when `--base <ref>` was given, the ref its branch left. */
export async function openReviewTarget(invocation: Invocation): Promise<{ repo: Repo; base: string | undefined }> {
  const { values } = parseArgs({ args: invocation.args, options: { base: { type: "string" } } });
  return { repo: await Repo.open(invocation.cwd), base: values.base };
}
