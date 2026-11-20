const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * An ISO timestamp as the relative string the shell's lists render.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the result is a
 * function of its inputs and can be tested.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    // Better to show the raw value than to claim a time we could not read.
    return iso;
  }
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) {
    return "just now";
  }
  if (seconds < 45) {
    return "just now";
  }
  if (seconds < HOUR) {
    return plural(Math.round(seconds / MINUTE), "minute");
  }
  if (seconds < DAY) {
    return plural(Math.round(seconds / HOUR), "hour");
  }
  return plural(Math.round(seconds / DAY), "day");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
