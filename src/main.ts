import { text } from "node:stream/consumers";
import type { BaseCommand } from "./lib/base-command.ts";
import { CheckCommand } from "./commands/check.ts";

const COMMANDS: BaseCommand[] = [new CheckCommand()];

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
