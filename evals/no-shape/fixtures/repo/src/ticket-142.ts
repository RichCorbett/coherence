import type { Booking } from "./lib/bookings.ts";

export function deskLoad(all: Booking[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const booking of all) {
    load.set(booking.desk, (load.get(booking.desk) ?? 0) + booking.people.length);
  }
  return load;
}
