import { BaseCommand, Exit, type Invocation } from "../lib/base-command.ts";
import { appendTaste, readTaste, VERDICTS, type Verdict } from "../lib/taste.ts";

/** Shows the owner's taste, or records one more finding the owner accepted or rejected. */
export class TasteCommand extends BaseCommand {
  readonly name = "taste";
  readonly usage = 'coherence taste [accepted|rejected "<finding>"]';

  async execute(invocation: Invocation): Promise<number> {
    const [verb, ...words] = invocation.args;
    if (verb === undefined) {
      invocation.print((await readTaste()).trimEnd());
      return Exit.ok;
    }

    const finding = words.join(" ").trim();
    if (!isVerdict(verb) || finding === "") {
      invocation.printError(`usage: ${this.usage}`);
      return Exit.usage;
    }
    await appendTaste(verb, finding);
    return Exit.ok;
  }
}

function isVerdict(word: string): word is Verdict {
  return (VERDICTS as readonly string[]).includes(word);
}
