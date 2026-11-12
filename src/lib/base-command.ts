/** What a command's exit code means. `unavailable` comes only from bin/coherence, when node cannot run. */
export const Exit = { ok: 0, findings: 1, usage: 2, failed: 3, unavailable: 4 } as const;

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

  /** Reports a usage error: the command's usage line on stderr, and the usage exit code. */
  protected refuse(invocation: Invocation): number {
    invocation.printError(`usage: ${this.usage}`);
    return Exit.usage;
  }
}
