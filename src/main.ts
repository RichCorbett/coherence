import { text } from "node:stream/consumers";
import { Exit, type BaseCommand, type Invocation } from "./lib/base-command.ts";
import { CheckCommand } from "./commands/check.ts";
import { GateCommand } from "./commands/gate.ts";
import { PrGateCommand } from "./commands/pr-gate.ts";
import { SecondOpinionCommand } from "./commands/second-opinion.ts";
import { TasteCommand } from "./commands/taste.ts";

const COMMANDS: BaseCommand[] = [new CheckCommand(), new GateCommand(), new PrGateCommand(), new TasteCommand(), new SecondOpinionCommand()];

const [name, ...args] = process.argv.slice(2);
const command = COMMANDS.find((candidate) => candidate.name === name);

const invocation: Invocation = {
  args,
  cwd: process.cwd(),
  readStdin: () => text(process.stdin),
  print: (line) => console.log(line),
  printError: (line) => console.error(line),
};

if (!command) {
  invocation.printError(`usage:\n${COMMANDS.map((candidate) => `  ${candidate.usage}`).join("\n")}`);
  process.exit(Exit.usage);
}

try {
  process.exitCode = await command.execute(invocation);
} catch (error) {
  invocation.printError(`coherence ${command.name}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = Exit.failed;
}
