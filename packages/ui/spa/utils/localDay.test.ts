import { formatLocalDay, parseLocalDay } from "./localDay";

/**
 * `parseLocalDay` that narrows away the `null` at RUNTIME.
 *
 * `expect(x).not.toBeNull()` does not narrow the type, so the call sites used to
 * reach for `as Date` - which CLAUDE.md rules out, and which would hide exactly
 * the null this helper reports.
 */
function parseDayOrThrow(value: string): Date {
  const parsed = parseLocalDay(value);
  if (parsed === null) {
    throw new Error(`Expected ${JSON.stringify(value)} to parse as a day`);
  }
  return parsed;
}

describe("formatLocalDay", () => {
  test("reads the local calendar fields, never the UTC ones", () => {
    // This is the regression. East of UTC, local midnight on the 20th is still
    // the 19th in UTC, so reading the UTC fields - which is what
    // `toISOString().slice(0, 10)` did - stored the day before the one the
    // editor picked.
    //
    // Node caches the ambient timezone before a test file can change it, and CI
    // runs in UTC, where the two readings happen to agree. So instead of
    // forcing a timezone, this passes a day whose local fields are all that is
    // on offer: an implementation that reaches for `toISOString()` or the
    // `getUTC*` getters finds nothing and fails here.
    const localMidnightEastOfUtc = {
      getFullYear: () => 2026,
      getMonth: () => 7,
      getDate: () => 20,
    };
    expect(formatLocalDay(localMidnightEastOfUtc)).toStrictEqual("2026-08-20");
  });

  test("formats the day a calendar hands back", () => {
    // `new Date(y, m, d)` is local midnight, which is what react-day-picker
    // passes to onSelect.
    expect(formatLocalDay(new Date(2026, 7, 20))).toStrictEqual("2026-08-20");
    expect(formatLocalDay(new Date(2026, 0, 1))).toStrictEqual("2026-01-01");
    expect(formatLocalDay(new Date(2026, 11, 31))).toStrictEqual("2026-12-31");
    expect(formatLocalDay(new Date(2024, 1, 29))).toStrictEqual("2024-02-29");
  });

  test("pads single digit months, days and short years", () => {
    expect(formatLocalDay(new Date(2026, 0, 2))).toStrictEqual("2026-01-02");
    expect(formatLocalDay(fields(999, 8, 9))).toStrictEqual("0999-09-09");
  });

  test("agrees with the UTC reading only when the offset allows it", () => {
    // Documents the actual failure on a developer machine: in a zone ahead of
    // UTC the two readings differ, and the local one is the correct day. In UTC
    // this assertion is vacuous, which is why the first test exists.
    const picked = new Date(2026, 7, 20);
    expect(formatLocalDay(picked)).toStrictEqual("2026-08-20");
    if (picked.getTimezoneOffset() < 0) {
      expect(picked.toISOString().slice(0, 10)).not.toStrictEqual(
        formatLocalDay(picked),
      );
    }
  });
});

describe("parseLocalDay", () => {
  test("parses a day to local midnight", () => {
    const date = parseLocalDay("2026-08-20");
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toStrictEqual(2026);
    expect(date?.getMonth()).toStrictEqual(7);
    expect(date?.getDate()).toStrictEqual(20);
  });

  test("round-trips with formatLocalDay", () => {
    for (const day of [
      "2026-01-01",
      "2026-06-15",
      "2026-08-20",
      "2026-12-31",
      "2024-02-29", // leap day
      "2026-03-29", // DST starts in Europe/Oslo
      "2026-10-25", // DST ends in Europe/Oslo
      "2026-09-27", // DST starts in Pacific/Auckland
      "2026-03-08", // DST starts at midnight in America/Havana
      "1900-01-01",
      "2100-12-31",
    ]) {
      expect(formatLocalDay(parseDayOrThrow(day))).toStrictEqual(day);
    }
  });

  test("takes only the date part of a full ISO datetime", () => {
    // s.date() does not validate the shape of its value, so content can hold a
    // datetime. The day is taken as written rather than shifted into the
    // browser's timezone.
    expect(
      formatLocalDay(parseDayOrThrow("2026-08-20T23:30:00Z")),
    ).toStrictEqual("2026-08-20");
    expect(
      formatLocalDay(parseDayOrThrow("2026-08-20T00:30:00Z")),
    ).toStrictEqual("2026-08-20");
  });

  test("returns null for values that are not a day", () => {
    for (const value of [
      "",
      "the 3rd of May",
      "20-08-2026",
      "2026/08/20",
      "26-08-20",
      "August 20, 2026",
      "not-a-date",
      // A day with anything after it. The prefix match used to accept these and
      // silently reinterpret the value as the 20th.
      "2026-08-20foo",
      "2026-08-20 ",
      "2026-08-2",
      "2026-08-201",
      "2026-08-20-01",
    ]) {
      expect(parseLocalDay(value)).toBeNull();
    }
  });

  test("returns null for a day that does not exist", () => {
    // Date rolls these over (2026-02-31 becomes the 3rd of March) instead of
    // failing, which would silently move the value.
    for (const value of [
      "2026-02-31",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2025-02-29", // 2025 is not a leap year
    ]) {
      expect(parseLocalDay(value)).toBeNull();
    }
  });
});

function fields(year: number, month: number, day: number) {
  return {
    getFullYear: () => year,
    getMonth: () => month,
    getDate: () => day,
  };
}
