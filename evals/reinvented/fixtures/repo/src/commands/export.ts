import { BaseCommand } from "../lib/base-command.ts";
import { bookings } from "../lib/bookings.ts";

function cloneDeep<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(cloneDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneDeep(item)])) as T;
  }
  return value;
}

export class ExportCommand extends BaseCommand {
  readonly name = "export";

  execute(): string {
    return JSON.stringify(cloneDeep(bookings));
  }
}
