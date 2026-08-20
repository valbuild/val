/**
 * Conversion between the plain calendar days that `s.date()` stores
 * (`YYYY-MM-DD`, no time and no timezone) and the `Date` objects the date
 * pickers work with.
 *
 * A `Date` is an instant, not a day, so the conversion has to go through its
 * *local* calendar fields. Going through `toISOString()` instead reads the UTC
 * fields of that instant, which is a different day for everyone east of UTC:
 * the local midnight a calendar hands back for the 20th is 22:00 on the 19th
 * in UTC, so the day that gets stored is the day before the one that was
 * picked.
 */

const DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * The local calendar fields of a `Date`.
 *
 * These three getters are all a day is, and naming them in the signature keeps
 * the "local fields, never UTC" contract checkable from a test in any timezone
 * - Node caches the ambient zone before a test file can change it.
 */
type LocalCalendarFields = Pick<Date, "getFullYear" | "getMonth" | "getDate">;

/**
 * Format a `Date` as the `YYYY-MM-DD` day it represents locally.
 *
 * Round-trips with `parseLocalDay` in every timezone.
 */
export function formatLocalDay(date: LocalCalendarFields): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a stored date value into a `Date` at local midnight of that day.
 *
 * The day is read from the leading `YYYY-MM-DD` of the value, so a full ISO
 * datetime is accepted too and contributes only its date part - the day as
 * written, never shifted into another timezone.
 *
 * Returns `null` for a value that is not a date. `s.date()` validates the
 * bounds of its value but not the shape, so content can legitimately hold a
 * string that is not a day at all, and the field has to render anyway.
 */
export function parseLocalDay(value: string): Date | null {
  const match = DAY_PREFIX.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // Out-of-range fields roll over instead of failing (2026-02-31 becomes the
  // 3rd of March), so reject anything that did not survive the round trip.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}
