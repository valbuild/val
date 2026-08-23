import { runAll, SCENARIO_NOTES, type ScenarioResult } from "./scenarios";

/**
 * The browser entry point.
 *
 * Everything the benchmark needs is bundled into one file and hung off `window`,
 * so the runner outside can call it over CDP and read plain JSON back. No
 * framework and no DOM: the numbers are about the stores, and a React tree in the
 * middle would put its own reconciliation into every measurement.
 */
export type BenchPayload = {
  results: ScenarioResult[];
  notes: Record<string, string>;
  env: { userAgent: string; cores: number | null };
};

declare global {
  interface Window {
    valBench: {
      run(repetitions?: number, sizes?: string[]): Promise<BenchPayload>;
    };
  }
}

window.valBench = {
  async run(repetitions, sizes) {
    const results = await runAll(repetitions, sizes);
    return {
      results,
      notes: SCENARIO_NOTES,
      env: {
        userAgent: navigator.userAgent,
        cores:
          typeof navigator.hardwareConcurrency === "number"
            ? navigator.hardwareConcurrency
            : null,
      },
    };
  },
};
