/**
 * What every surface showed, in order: a frame each time the world observes.
 * The invariants are checked against this log, so a failure can say which
 * surface broke which rule, and when.
 *
 * Frames carry values only for now. The plan (`docs/plans/one-content-model.md`)
 * adds the source that answered and the version once phase 1 puts versions on
 * the wire; until then two versions with equal values look the same, which is
 * weaker but enough for the first scenarios.
 */

export type Frame = {
  /** Which observation this was: 0, 1, 2 … */
  at: number;
  surface: string;
  value: unknown;
};

export type Frames = {
  record(surface: string, value: unknown): void;
  /** Called by the world after each observation of every surface. */
  tick(): void;
  readonly all: readonly Frame[];
  of(surface: string): Frame[];
  /** The last value a surface showed. */
  last(surface: string): unknown;
  expectInvariants(): void;
  /**
   * Only "never goes back": for surfaces that show DIFFERENT things (two
   * fields), which "converges" -- every surface shows the same value at the
   * end -- does not apply to.
   */
  expectNeverGoesBack(): void;
};

export function createFrames(): Frames {
  const all: Frame[] = [];
  let at = 0;
  const of = (surface: string) => all.filter((f) => f.surface === surface);
  return {
    record(surface, value) {
      all.push({ at, surface, value });
    },
    tick() {
      at++;
    },
    get all() {
      return all;
    },
    of,
    last(surface) {
      return of(surface).at(-1)?.value;
    },
    expectNeverGoesBack() {
      const problems = neverGoesBack(all);
      if (problems.length > 0) {
        throw new Error(
          `${problems.join("\n\n")}\n\nAll frames:\n${describe(all)}`,
        );
      }
    },
    expectInvariants() {
      const problems = [...converges(all), ...neverGoesBack(all)];
      if (problems.length > 0) {
        throw new Error(
          `${problems.join("\n\n")}\n\nAll frames:\n${describe(all)}`,
        );
      }
    },
  };
}

/**
 * 1. At the end, every surface shows the same value: each surface's LAST
 * frame, wherever it was recorded. (Comparing only the frames of the last
 * observation missed a surface that stopped recording earlier -- a loader
 * nothing re-ran -- which is exactly the surface that is behind.)
 */
function converges(all: readonly Frame[]): string[] {
  const last = new Map<string, Frame>();
  for (const frame of all) last.set(frame.surface, frame);
  const values = new Set(
    [...last.values()].map((f) => JSON.stringify(f.value)),
  );
  if (values.size <= 1) return [];
  return [
    `✕ converges: the surfaces disagree at the end\n${describe([...last.values()])}`,
  ];
}

/** 2. No surface shows a value, then another, then the first again. */
function neverGoesBack(all: readonly Frame[]): string[] {
  const problems: string[] = [];
  for (const surface of new Set(all.map((f) => f.surface))) {
    const shown: string[] = [];
    for (const frame of all.filter((f) => f.surface === surface)) {
      const value = JSON.stringify(frame.value);
      if (shown.at(-1) === value) continue;
      if (shown.includes(value)) {
        problems.push(
          `✕ never goes back: "${surface}" showed ${value} again at ${frame.at}, after ${shown.at(-1)}`,
        );
        break;
      }
      shown.push(value);
    }
  }
  return problems;
}

function describe(frames: readonly Frame[]): string {
  return frames
    .map(
      (f) =>
        `  ${String(f.at).padStart(3)}  ${f.surface.padEnd(12)} ${JSON.stringify(f.value)}`,
    )
    .join("\n");
}
