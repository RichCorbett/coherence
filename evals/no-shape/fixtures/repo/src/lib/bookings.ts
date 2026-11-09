import { intakePass } from "../intake-pass.ts";

export type Booking = { desk: string; day: Date; people: string[] };

export const bookings: Booking[] = intakePass(["A1 2026-11-09 sam"]);
