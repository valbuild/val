/**
 * What a number schema accepts, in one place, so the validator and the
 * Studio's "Round to …" / "Set to …" buttons cannot disagree about it.
 *
 * A button that offers a value the validator then rejects is worse than no
 * button, which is exactly what two copies of this arithmetic would drift into.
 */
export type NumberRules = {
  min?: number;
  max?: number;
  /** Whole numbers only — `s.int()`. */
  integer?: boolean;
  /** Allowed values are `origin + n * step`, where the origin is `min` or 0. */
  step?: number;
};

/**
 * Division of decimals is not exact (`0.3 / 0.1` is `2.9999999999999996`), so a
 * value counts as on the grid when it is within this many steps of it.
 */
const GRID_EPSILON = 1e-9;

/** Where the step grid starts: the schema's `min`, or 0 when it has none. */
export function stepOrigin(rules: NumberRules): number {
  return rules.min ?? 0;
}

/** Is `value` one of `origin + n * step`? */
export function isOnStep(value: number, origin: number, step: number): boolean {
  const steps = (value - origin) / step;
  return Math.abs(steps - Math.round(steps)) < GRID_EPSILON;
}

/**
 * The allowed value closest to `value`: inside `min`/`max`, on the step grid,
 * and whole when the schema is an int.
 *
 * Returns `null` when the rules leave nothing to snap to — a `min` above
 * `max`, or a range too narrow to hold a single step or a single whole number.
 */
export function nearestAllowedNumber(
  value: number,
  rules: NumberRules,
): number | null {
  const step = rules.step ?? (rules.integer ? 1 : undefined);
  const lo = rules.min;
  const hi = rules.max;
  if (lo !== undefined && hi !== undefined && lo > hi) {
    return null;
  }
  const clamp = (n: number) =>
    Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, n));
  if (step === undefined) {
    return clamp(value);
  }
  const origin =
    rules.integer && rules.step === undefined ? 0 : stepOrigin(rules);
  const toGrid = (n: number) => roundToDecimals(origin + n * step);
  let n = Math.round((clamp(value) - origin) / step);
  // Rounding can step outside the range by one; walk back in.
  if (lo !== undefined && toGrid(n) < lo) n += 1;
  if (hi !== undefined && toGrid(n) > hi) n -= 1;
  const snapped = toGrid(n);
  if (
    (lo !== undefined && snapped < lo) ||
    (hi !== undefined && snapped > hi)
  ) {
    return null;
  }
  if (rules.integer && !Number.isInteger(snapped)) {
    return null;
  }
  return snapped;
}

/**
 * `0.1 + 0.2` is `0.30000000000000004`. A value offered to an editor should
 * read `0.3`, so grid values are rounded to 12 significant decimals — far below
 * any step anyone writes, far above floating point noise.
 */
function roundToDecimals(n: number): number {
  return Number.parseFloat(n.toFixed(12));
}
