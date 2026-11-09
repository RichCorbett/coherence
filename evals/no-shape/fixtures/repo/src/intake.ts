import type { Booking } from "./lib/bookings.ts";

export function parseIntake(line: string): Booking {
  const [desk, day, ...people] = line.trim().split(/\s+/);
  return { desk, day: new Date(day), people };
}
