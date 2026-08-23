import {
  buildForMemory,
  releaseMemoryHold,
  runAll,
  SCENARIO_NOTES,
  type ScenarioResult,
} from "./scenarios";
import { generateProject, SIZES } from "./generateProject";
import { runReactScenario, type ReactSample } from "./reactHarness";
import {
  measureProbeFloor,
  runSeam,
  type SeamResult,
} from "./workerSeamScenarios";

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
      /** Build a system and hold it, so the runner can GC and weigh the heap. */
      buildForMemory(
        driver: string,
        size: string,
      ): Promise<{ fieldsReady: number; modules: number }>;
      releaseMemoryHold(): void;
      /** The same comparison with React mounted, which the plain run cannot see. */
      runReact(
        repetitions?: number,
        sizes?: string[],
      ): Promise<{ driver: string; size: string; samples: ReactSample[] }[]>;
      /**
       * The worker realm in a REAL worker, against the same realm in-process.
       * A different question from every other measurement here: not "which
       * system", but "is this seam worth crossing".
       */
      runWorkerSeam(
        repetitions?: number,
        sizes?: string[],
      ): Promise<{ probeFloorMs: number; results: SeamResult[] }>;
    };
  }
}

window.valBench = {
  buildForMemory,
  async runWorkerSeam(repetitions = 5, sizes = Object.keys(SIZES)) {
    // The floor first, on an idle page: a block reading at the probe's own
    // resolution means "nothing longer than this happened", and a reader cannot
    // tell that from the reading alone.
    const probeFloorMs = await measureProbeFloor();
    return { probeFloorMs, results: await runSeam(repetitions, sizes) };
  },
  releaseMemoryHold,
  async runReact(repetitions = 5, sizes = Object.keys(SIZES)) {
    const rows: { driver: string; size: string; samples: ReactSample[] }[] = [];
    for (const sizeName of sizes) {
      for (const driver of ["ValSyncEngine", "stores"]) {
        const samples: ReactSample[] = [];
        for (let rep = 0; rep <= repetitions; rep++) {
          // A fresh project and a fresh React root per repetition, for the same
          // reason the plain scenarios do it: sharing would let one repetition's
          // caches serve the next, and the two systems cache differently.
          const project = generateProject(SIZES[sizeName]);
          const sample = await runReactScenario(
            driver,
            project.modules,
            project.mountedPaths,
            project.typedModule,
            project.typedFieldPath,
          );
          if (rep > 0) samples.push(sample);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        rows.push({ driver, size: sizeName, samples });
      }
    }
    return rows;
  },
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
