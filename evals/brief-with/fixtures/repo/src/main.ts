import type { BaseCommand } from "./lib/base-command.ts";
import { ExportCommand } from "./commands/export.ts";
import { ListCommand } from "./commands/list.ts";
import { PingCommand } from "./commands/ping.ts";
import { ReportCommand } from "./commands/report.ts";

const COMMANDS: BaseCommand[] = [new PingCommand(), new ListCommand(), new ReportCommand(), new ExportCommand()];

export function dispatch(line: string): string {
  const [name, ...args] = line.trim().split(/\s+/);
  const command = COMMANDS.find((candidate) => candidate.name === name);
  return command ? command.execute(args) : `unknown command: ${name}`;
}
