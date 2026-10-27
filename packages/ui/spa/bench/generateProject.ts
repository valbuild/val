import { initVal, type SelectorSource, type ValModule } from "@valbuild/core";

/**
 * A synthetic Val project of a chosen size.
 *
 * Synthetic rather than a real project because the measurement has to be a
 * FUNCTION of project size — the whole claim under test is that a keystroke's
 * cost should be proportional to the edited field rather than to the project, and
 * a single fixed project cannot show a slope. A real project gives one point.
 *
 * The shape is chosen to include the case that actually hurts, not just the easy
 * one:
 *
 * - **plain modules** — objects of strings with `minLength` validators, so schema
 *   validation has real work to do rather than returning `false` immediately;
 * - **list modules** — `s.array(item.preview(select))`, where `select` is a user
 *   closure declared on the item schema and invoked per row. This is the
 *   expensive thing;
 * - **one nested list** — a list whose items each contain a list, both with a
 *   `preview`. This is the `handboka` shape, the worst case named throughout
 *   `architecture.md`, and the reason path-scoped previews were built.
 *
 * `select` is instrumented so a run can report how many times it ran. A duration
 * without that number cannot distinguish "faster" from "did less".
 */
export type ProjectSize = {
  /** Plain object modules. */
  plainModules: number;
  /** Fields per plain module. */
  fieldsPerModule: number;
  /** Modules that are a previewed list. */
  listModules: number;
  /** Rows per list module. */
  rowsPerList: number;
  /** Chapters in the nested module; each holds the same number of sections. */
  nestedChapters: number;
  /**
   * Fields of ONE module that are mounted at once.
   *
   * Default 2, which is what the first version of this file did — and that was a
   * flaw the React harness exposed rather than a finding. A real Studio screen is
   * an editor for ONE page: many fields of one module, on screen together. Two
   * fields per module across 141 modules is the opposite shape, and it measures
   * per-module-vs-per-path notification at its least favourable, because a
   * per-module notification only reaches two fields.
   */
  mountedPerModule?: number;
  /**
   * How many modules have ANY fields mounted. Default: all of them.
   *
   * This exists because a reviewer asked why a benchmark was registering 260
   * listeners, and the honest answer was that the fixture was wrong. One
   * listener per rendered field is exactly right — but a Studio screen is ONE
   * PAGE open, so the mounted fields belong to one module and the other 120
   * modules have nothing on screen at all.
   *
   * It matters because two of the costs measured here are LINEAR in mounted
   * fields: listener registration, and the per-path read cache. Mounting 1202
   * fields overstates both against a screen that mounts sixty.
   */
  mountedModules?: number;
};

export const SIZES: Record<string, ProjectSize> = {
  /** Roughly a small site. */
  small: {
    plainModules: 10,
    fieldsPerModule: 8,
    listModules: 3,
    rowsPerList: 20,
    nestedChapters: 5,
  },
  /** Roughly a content-heavy site — the size the current engine is slow on. */
  large: {
    plainModules: 120,
    fieldsPerModule: 12,
    listModules: 20,
    rowsPerList: 60,
    nestedChapters: 25,
  },
  /**
   * One page open, with all of its fields on screen. The shape a Studio screen
   * actually is.
   *
   * The point of this size is the FAN-OUT of a notification, not project size:
   * the engine's finest source subscription is per module, so typing into one
   * field of an open page notifies every other field of that page. Per-path
   * notification wakes one. The `large` size cannot show that, because it mounts
   * two fields per module.
   */
  page: {
    plainModules: 20,
    fieldsPerModule: 60,
    listModules: 2,
    rowsPerList: 20,
    nestedChapters: 5,
    mountedPerModule: 60,
  },
  /**
   * MEASURED against the real Studio, and the one to quote.
   *
   * Not a guess. `examples/next` was run for real — Next dev server plus the UI's
   * Vite dev server — and the Studio driven over CDP to count what a screen
   * actually mounts. Two screens, both on a 141-module project:
   *
   * - `/~/app/page.val.ts`, the richest real module (object, array, keyOf, route,
   *   richtext, file): a content area of 63 elements showing ~15 field rows.
   * - `/~/content/handbook.val.ts`, a 24-chapter list: 507 elements, 74
   *   buttons, ~24 rows.
   *
   * The Studio renders a compact PREVIEW row per field rather than a form full of
   * inputs, so a screen is on the order of 15-25 field components. Every fixture
   * before this one mounted 60, 260 or 1202 — 3x to 50x too many, which
   * overstated every cost that is linear in mounted fields.
   */
  screen: {
    plainModules: 120,
    fieldsPerModule: 60,
    listModules: 20,
    rowsPerList: 60,
    nestedChapters: 25,
    mountedPerModule: 16,
    mountedModules: 1,
  },
  /**
   * A large project with ONE page open, every field of it mounted.
   *
   * 141 modules loaded, and 60 fields on screen — all in the same module,
   * because that is what an editor screen is. Every other module is loaded and
   * unmounted, exactly as it would be while you edit one page.
   *
   * Kept as the pessimistic end of what a screen could be — every field of a
   * 60-field page in edit mode rather than preview. `screen` above is what was
   * actually measured. `page` and `large` mount 1202 and 260, which is useful for
   * finding scaling defects (it is how the O(registered paths) listener scan was
   * caught) and misleading as a description of a session.
   */
  realistic: {
    plainModules: 120,
    fieldsPerModule: 60,
    listModules: 20,
    rowsPerList: 60,
    nestedChapters: 25,
    mountedPerModule: 60,
    mountedModules: 1,
  },
};

export type GeneratedProject = {
  modules: ValModule<SelectorSource>[];
  /** Total `select` invocations since the last `resetSelectCalls`. */
  selectCalls: () => number;
  resetSelectCalls: () => void;
  /** A path in a plain module — what a text field being typed into looks like. */
  typedFieldPath: string;
  /** The module that path is in. */
  typedModule: string;
  /** Paths a UI would plausibly have mounted at once. */
  mountedPaths: string[];
  /** A path inside the nested list, for the preview worst case. */
  nestedRowPath: string;
  nestedModule: string;
  moduleCount: number;
};

export function generateProject(size: ProjectSize): GeneratedProject {
  const { s, c } = initVal();
  let selectCalls = 0;
  const modules: ValModule<SelectorSource>[] = [];
  const mountedPaths: string[] = [];

  const mountedModules = size.mountedModules ?? Number.POSITIVE_INFINITY;
  for (let m = 0; m < size.plainModules; m++) {
    const path = `/page-${m}.val.ts`;
    const items: Record<string, ReturnType<typeof s.string>> = {};
    const source: Record<string, string> = {};
    for (let f = 0; f < size.fieldsPerModule; f++) {
      items[`field${f}`] = s.string().minLength(2);
      source[`field${f}`] = `page ${m} field ${f}`;
    }
    modules.push(c.define(path, s.object(items), source));
    // How many of this module's fields are on screen at once. See
    // `mountedPerModule`: two is a site-wide sample, sixty is one open page, and
    // the difference is the fan-out of a per-module notification.
    const mounted =
      m < mountedModules
        ? Math.min(size.mountedPerModule ?? 2, size.fieldsPerModule)
        : 0;
    for (let f = 0; f < mounted; f++) {
      mountedPaths.push(`${path}?p="field${f}"`);
    }
  }

  for (let l = 0; l < size.listModules; l++) {
    const path = `/list-${l}.val.ts`;
    const rows = Array.from({ length: size.rowsPerList }, (_unused, r) => ({
      title: `row ${r}`,
      body: `body of row ${r} in list ${l}`,
    }));
    modules.push(
      c.define(
        path,
        s.array(
          s
            .object({ title: s.string().minLength(2), body: s.string() })
            .preview(({ val }) => {
              selectCalls++;
              return { title: val.title, subtitle: val.body };
            }),
        ),
        rows,
      ),
    );
    // A list module counts against the same budget: with one page open, the
    // lists on other screens are not mounted either.
    if (l + size.plainModules < mountedModules) {
      mountedPaths.push(`${path}?p=0`);
    }
  }

  const nestedModule = "/handbook.val.ts";
  modules.push(
    c.define(
      nestedModule,
      s.array(
        s
          .object({
            title: s.string().minLength(2),
            sections: s.array(
              s
                .object({ heading: s.string().minLength(2) })
                .preview(({ val }) => {
                  selectCalls++;
                  return { title: val.heading };
                }),
            ),
          })
          .preview(({ val }) => {
            selectCalls++;
            return { title: val.title };
          }),
      ),
      Array.from({ length: size.nestedChapters }, (_unused, chapter) => ({
        title: `chapter ${chapter}`,
        sections: Array.from(
          { length: size.nestedChapters },
          (_unused2, section) => ({
            heading: `section ${chapter}.${section}`,
          }),
        ),
      })),
    ),
  );

  return {
    modules,
    selectCalls: () => selectCalls,
    resetSelectCalls: () => {
      selectCalls = 0;
    },
    typedModule: "/page-0.val.ts",
    typedFieldPath: '/page-0.val.ts?p="field0"',
    mountedPaths,
    nestedModule,
    nestedRowPath: `${nestedModule}?p=0."sections".0`,
    moduleCount: modules.length,
  };
}
