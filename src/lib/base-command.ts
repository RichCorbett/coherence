export type Invocation = {
  args: string[];
  cwd: string;
  readStdin: () => Promise<string>;
  print: (text: string) => void;
};

/** One thing `coherence` can do. Adding a command means adding one file in `commands/`. */
export abstract class BaseCommand {
  abstract readonly name: string;
  abstract readonly usage: string;

  /** Returns the process exit code. */
  abstract execute(invocation: Invocation): Promise<number>;
}
