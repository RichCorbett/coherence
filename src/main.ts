import { text } from "node:stream/consumers";
import type { BaseCommand } from "./lib/base-command.ts";
import { CheckCommand } from "./commands/check.ts";
import { GateCommand } from "./commands/gate.ts";
import { SecondOpinionCommand } from "./commands/second-opinion.ts";
import { TasteCommand } from "./commands/taste.ts";

const COMMANDS: BaseCommand[] = [new CheckCommand(), new GateCommand(), new TasteCommand(), new SecondOpinionCommand()];

const [name, ...args] = process.argv.slice(2);
const command = COMMANDS.find((candidate) => candidate.name === name);

if (!command) {
  console.error(`usage:\n${COMMANDS.map((candidate) => `  ${candidate.usage}`).join("\n")}`);
  process.exit(2);
}

process.exitCode = await command.execute({
  args,
  cwd: process.cwd(),
  readStdin: () => text(process.stdin),
  print: (line) => console.log(line),
});
