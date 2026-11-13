import { ListCommand } from "../commands/list.ts";

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatHelp(): string {
  return `${new ListCommand().name}: shows each booking by day`;
}
