import {
  generateProject,
  SIZES,
  type GeneratedProject,
  type ProjectSize,
} from "./generateProject";
import { storesDriver, type Driver } from "./drivers";

/**
 * One measurement: how long, how many closure invocations, and how many fields
 * actually ended up ready.
 *
 * `fieldsReady` is reported rather than asserted-and-dropped because it is the
 * guard against the classic benchmark lie — a system that is fast because it
 * silently did nothing. A row where the two systems disagree on `fieldsReady`
 * is not a comparison and must be read as a bug in the harness.
 */
export type Sample = {
  ms: number;
  /** The part that runs synchronously in the keydown handler, where measurable. */
  blockingMs: number;
  selectCalls: number;
  fieldsReady: number;
};

export type ScenarioResult = {
  scenario: string;
  driver: string;
  size: string;
  samples: Sample[];
};

const now = () => performance.now();

/**
 * Each scenario builds a FRESH project and driver per repetition.
 *
 * Sharing them would let one repetition's caches serve the next, which for two
 * systems with different caching strategies is not a wash — it is a thumb on the
 * scale for whichever one caches more.
 */
type Scenario = {
  name: string;
  /** What it measures, in the report. */
  note: string;
  run(makeDriver: () => Driver, size: ProjectSize): Promise<Sample>;
};

export const SCENARIOS: Scenario[] = [
  {
    name: "intake",
    note: "adopting the project: schemas serialized, source taken in",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      const start = now();
      await driver.setup(project.modules);
      const ms = now() - start;
      const reads = await driver.readAll();
      driver.dispose();
      return {
        ms,
        blockingMs: ms,
        selectCalls: project.selectCalls(),
        fieldsReady: reads.fieldsReady,
      };
    },
  },
  {
    name: "mount",
    note: "every field mounts and paints for the first time",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      await driver.setup(project.modules);
      project.resetSelectCalls();
      const start = now();
      await driver.mount(project.mountedPaths);
      const reads = await driver.readAll();
      const ms = now() - start;
      driver.dispose();
      return {
        ms,
        blockingMs: ms,
        selectCalls: project.selectCalls(),
        fieldsReady: reads.fieldsReady,
      };
    },
  },
  {
    name: "mount-only",
    note: "registering interest, WITHOUT reading - isolates the two halves of mount",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      await driver.setup(project.modules);
      project.resetSelectCalls();
      const start = now();
      await driver.mount(project.mountedPaths);
      const ms = now() - start;
      driver.dispose();
      // Deliberately 0: nothing was read, so nothing is ready. Paired with
      // `mount` above, the difference between the two is the read cost, which
      // is the only way to tell a slow registry from a slow read protocol.
      return {
        ms,
        blockingMs: ms,
        selectCalls: project.selectCalls(),
        fieldsReady: 0,
      };
    },
  },
  {
    name: "keystroke",
    note: "THE headline: one character typed, every mounted field repaints",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      await driver.setup(project.modules);
      await driver.mount(project.mountedPaths);
      await driver.readAll();
      project.resetSelectCalls();

      const start = now();
      await driver.type(project.typedModule, project.typedFieldPath, "typed x");
      const blockingMs = now() - start;
      const reads = await driver.readAll();
      const ms = now() - start;
      driver.dispose();
      return {
        ms,
        blockingMs,
        selectCalls: project.selectCalls(),
        fieldsReady: reads.fieldsReady,
      };
    },
  },
  {
    name: "keystroke-list",
    note: "a character typed into a rendered list, where a render must be redone",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      await driver.setup(project.modules);
      // The container is mounted, so this is the honest hard case: the whole
      // list has to be re-rendered and neither system can scope anything away.
      // Typing into a plain module (the `keystroke` scenario) never re-renders
      // anything for either system, so it says nothing about render cost.
      await driver.mount(["/list-0.val.ts"]);
      await driver.readAll();
      project.resetSelectCalls();

      const start = now();
      await driver.type(
        "/list-0.val.ts",
        '/list-0.val.ts?p=0."title"',
        "typed into a row",
      );
      const blockingMs = now() - start;
      const reads = await driver.readAll();
      const ms = now() - start;
      driver.dispose();
      return {
        ms,
        blockingMs,
        selectCalls: project.selectCalls(),
        fieldsReady: reads.fieldsReady,
      };
    },
  },
  {
    name: "burst-40",
    note: "40 characters typed, then one repaint — the debounced-typing case",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      await driver.setup(project.modules);
      await driver.mount(project.mountedPaths);
      await driver.readAll();
      project.resetSelectCalls();

      const start = now();
      for (let index = 0; index < 40; index++) {
        await driver.type(
          project.typedModule,
          project.typedFieldPath,
          `typed ${index}`,
        );
      }
      const blockingMs = now() - start;
      const reads = await driver.readAll();
      const ms = now() - start;
      driver.dispose();
      return {
        ms,
        blockingMs,
        selectCalls: project.selectCalls(),
        fieldsReady: reads.fieldsReady,
      };
    },
  },
  {
    name: "list-view",
    note: "a list screen: the CONTAINER is mounted, so both must render every row",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      await driver.setup(project.modules);
      // Container paths, not row paths. Included deliberately: the keystroke
      // numbers would otherwise overstate the win, because a scoped render is
      // only cheaper when something less than the whole list is being shown. On
      // a list screen there is nothing to scope away and the two systems should
      // do the same amount of work.
      const listContainers = Array.from(
        { length: size.listModules },
        (_unused, index) => `/list-${index}.val.ts`,
      );
      project.resetSelectCalls();
      // The mount is INSIDE the timed region, and the counter is reset before
      // it. An earlier version reset after mounting, which meant the eager
      // render a mounting listener triggers had already happened and been
      // zeroed — so this scenario reported the stores running `select` zero
      // times for a screen that obviously has to render every row. It was
      // timing a cache hit.
      const start = now();
      await driver.mount(listContainers);
      const reads = await driver.readAll();
      const ms = now() - start;
      driver.dispose();
      return {
        ms,
        blockingMs: ms,
        selectCalls: project.selectCalls(),
        fieldsReady: reads.fieldsReady,
      };
    },
  },
  {
    name: "nested-row",
    note: "the handboka worst case: one section of one chapter, select at two levels",
    async run(makeDriver, size) {
      const project = generateProject(size);
      const driver = makeDriver();
      await driver.setup(project.modules);
      project.resetSelectCalls();
      // Mount inside the timed region, as in `list-view` and for the same
      // reason: the render is triggered by the mount, not by the read.
      const start = now();
      await driver.mount([project.nestedRowPath]);
      const reads = await driver.readOne(
        project.nestedModule,
        project.nestedRowPath,
      );
      const ms = now() - start;
      driver.dispose();
      return {
        ms,
        blockingMs: ms,
        selectCalls: project.selectCalls(),
        fieldsReady: reads.fieldsReady,
      };
    },
  },
];

/**
 * One driver now.
 *
 * There were two — the store system and `ValSyncEngine` — and the whole point of
 * the table was the ratio between them. The engine is gone, so what is left is a
 * baseline: absolute numbers for the system that shipped, which is what catches a
 * regression. The engine's last measured numbers are recorded in `README.md`, in
 * the one place they are still useful, which is as history.
 *
 * The shape stays an array so a second driver — a future alternative, or a
 * deliberately naive implementation to check a claim against — drops back in
 * without the runner changing.
 */
export const DRIVERS: { name: string; make: () => Driver }[] = [
  { name: "stores", make: storesDriver },
];

/**
 * Run everything.
 *
 * `repetitions + 1` runs per cell, first discarded: the first pass through any of
 * this pays for JIT warm-up and lazy module initialisation, and reporting it as
 * though it were steady state is how a benchmark accidentally measures the
 * compiler.
 */
export async function runAll(
  repetitions = 5,
  sizeNames: string[] = Object.keys(SIZES),
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const sizeName of sizeNames) {
    const size = SIZES[sizeName];
    for (const scenario of SCENARIOS) {
      for (const driver of DRIVERS) {
        const samples: Sample[] = [];
        for (let rep = 0; rep <= repetitions; rep++) {
          const sample = await scenario.run(driver.make, size);
          if (rep > 0) samples.push(sample);
          // Yield, so a long synchronous scenario cannot starve the next one's
          // timer and so the browser can settle between repetitions.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        results.push({
          scenario: scenario.name,
          driver: driver.name,
          size: sizeName,
          samples,
        });
      }
    }
  }
  return results;
}

export const SCENARIO_NOTES: Record<string, string> = Object.fromEntries(
  SCENARIOS.map((scenario) => [scenario.name, scenario.note]),
);

/**
 * A live system, held so it cannot be collected while its heap is measured.
 *
 * Memory has to be driven from OUTSIDE the page: the reading worth having is
 * retained heap after a forced GC, and both the GC and the measurement are CDP
 * calls. So the page's job is only to build the thing and hold on to it —
 * `build`, then the runner collects and reads, then `release`.
 *
 * `readAll` is included in the build because an unread system has not populated
 * its caches, and the caches are the interesting part: the engine keeps ~30
 * snapshot maps and deep-clones per module read, the stores clone nothing on the
 * read path. Measuring before the first read would compare two empty systems.
 */
let held: { driver: Driver; project: GeneratedProject } | null = null;

export async function buildForMemory(
  driverName: string,
  sizeName: string,
): Promise<{ fieldsReady: number; modules: number }> {
  releaseMemoryHold();
  const entry = DRIVERS.find((candidate) => candidate.name === driverName);
  if (entry === undefined) {
    throw new Error(`No such driver: ${driverName}`);
  }
  const project = generateProject(SIZES[sizeName]);
  const driver = entry.make();
  await driver.setup(project.modules);
  await driver.mount(project.mountedPaths);
  const reads = await driver.readAll();
  held = { driver, project };
  return { fieldsReady: reads.fieldsReady, modules: project.moduleCount };
}

export function releaseMemoryHold(): void {
  if (held !== null) {
    held.driver.dispose();
    held = null;
  }
}
