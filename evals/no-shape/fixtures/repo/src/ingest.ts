import type { Booking } from "./lib/bookings.ts";

export function ingestLine(raw: string): Booking | undefined {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 3) return undefined;
  const [desk, day, ...people] = parts;
  return { desk, day: new Date(day), people };
}
