import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { appendTaste, condenseTaste, readTaste, undoLastEntry, VERDICTS, type Verdict } from "../lib/taste.ts";

// Past this the log is long enough to crowd every prompt that reads it.
const CONDENSE_AT = 40;

/** Shows the owner's taste, records a decision, takes the newest one back, or condenses the log into rules. */
export class TasteCommand extends BaseCommand {
  readonly name = "taste";
  readonly usage = 'coherence taste [accepted|rejected "<finding>" | undo | condense (rules on stdin)]';

  async execute(invocation: Invocation): Promise<number> {
    const [verb, ...words] = invocation.args;
    if (verb === undefined) return this.show(invocation);
    if (verb === "undo") return this.undo(invocation);
    if (verb === "condense") return this.condense(invocation);

    const finding = words.join(" ").trim();
    if (!isVerdict(verb) || finding === "") return this.refuse(invocation);

    const entries = await appendTaste(verb, finding);
    invocation.print(`recorded; ${entries} waiting to be condensed`);
    if (entries >= CONDENSE_AT) invocation.print("The log is full: condense it now, as the coherence:taste skill describes.");
    return Exit.ok;
  }

  private async show(invocation: Invocation): Promise<number> {
    invocation.print((await readTaste()).trimEnd());
    return Exit.ok;
  }

  private async undo(invocation: Invocation): Promise<number> {
    const removed = await undoLastEntry();
    invocation.print(removed === undefined ? "nothing to undo" : `removed: ${removed}`);
    return Exit.ok;
  }

  private async condense(invocation: Invocation): Promise<number> {
    const rules = await invocation.readStdin();
    if (rules.trim() === "") return this.refuse(invocation);
    invocation.print(`condensed ${await condenseTaste(rules)} entries; originals are in the archive`);
    return Exit.ok;
  }

  private refuse(invocation: Invocation): number {
    invocation.printError(`usage: ${this.usage}`);
    return Exit.usage;
  }
}

function isVerdict(word: string): word is Verdict {
  return (VERDICTS as readonly string[]).includes(word);
}
