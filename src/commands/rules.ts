import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { readPluginFile } from "../lib/plugin-files.ts";

/** Prints the design rules code is held to, so the reader and anyone writing code share one standard. */
export class RulesCommand extends BaseCommand {
  readonly name = "rules";
  readonly usage = "coherence rules";

  async execute(invocation: Invocation): Promise<number> {
    invocation.print((await readPluginFile("rules/design.md")).trimEnd());
    return Exit.ok;
  }
}
