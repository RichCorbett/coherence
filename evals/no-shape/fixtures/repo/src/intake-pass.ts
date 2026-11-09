import type { Booking } from "./lib/bookings.ts";
import { parseIntake } from "./intake.ts";

export function intakePass(lines: string[]): Booking[] {
  return lines.filter((line) => line.trim() !== "").map((line) => parseIntake(line));
}
