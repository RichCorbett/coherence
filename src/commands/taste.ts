import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { appendTaste, condenseTaste, readTaste, undoLastTaste } from "../lib/taste.ts";

// Past this the log is long enough to crowd every prompt that reads it.
const CONDENSE_AT = 40;

/** Shows the owner's taste, adds a preference, takes the newest one back, or condenses the log into rules. */
export class TasteCommand extends BaseCommand {
  readonly name = "taste";
  readonly usage = 'coherence taste [add "<preference>" | undo | condense (rules on stdin)]';

  async execute(invocation: Invocation): Promise<number> {
    const [verb, ...words] = invocation.args;
    if (verb === undefined) return this.show(invocation);
    if (verb === "add") return this.add(invocation, words.join(" ").trim());
    if (verb === "undo") return this.undo(invocation);
    if (verb === "condense") return this.condense(invocation);
    return this.refuse(invocation);
  }

  private async show(invocation: Invocation): Promise<number> {
    invocation.print((await readTaste()).trimEnd());
    return Exit.ok;
  }

  private async add(invocation: Invocation, preference: string): Promise<number> {
    if (preference === "") return this.refuse(invocation);
    // The log is one entry per line and is printed under a heading, so a line break would forge entries or headings.
    if (/[\r\n]/.test(preference)) {
      invocation.printError("a preference is one line: no line breaks");
      return Exit.usage;
    }
    const entries = await appendTaste(preference);
    invocation.print(`recorded; ${entries} waiting to be condensed`);
    if (entries >= CONDENSE_AT) invocation.print("The log is full: condense it now, as the coherence:taste skill describes.");
    return Exit.ok;
  }

  private async undo(invocation: Invocation): Promise<number> {
    const removed = await undoLastTaste();
    invocation.print(removed === undefined ? "nothing to undo" : `removed: ${removed}`);
    return Exit.ok;
  }

  private async condense(invocation: Invocation): Promise<number> {
    const rules = await invocation.readStdin();
    if (rules.trim() === "") return this.refuse(invocation);
    invocation.print(`condensed ${await condenseTaste(rules)} entries; originals are in the archive`);
    return Exit.ok;
  }
}
