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
 * - **list modules** — `s.array(...).render({ as: "list", select })`, where
 *   `select` is a user closure invoked per row. This is the expensive thing;
 * - **one nested list** — a list whose items each contain a list, both with
 *   `select`. This is the `handboka` shape, the worst case named throughout
 *   `architecture.md`, and the reason path-scoped renders were built.
 *
 * `select` is instrumented so a run can report how many times it ran. A duration
 * without that number cannot distinguish "faster" from "did less".
 */
export type ProjectSize = {
  /** Plain object modules. */
  plainModules: number;
  /** Fields per plain module. */
  fieldsPerModule: number;
  /** Modules that are a rendered list. */
  listModules: number;
  /** Rows per list module. */
  rowsPerList: number;
  /** Chapters in the nested module; each holds the same number of sections. */
  nestedChapters: number;
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
  /** A path inside the nested list, for the render worst case. */
  nestedRowPath: string;
  nestedModule: string;
  moduleCount: number;
};

export function generateProject(size: ProjectSize): GeneratedProject {
  const { s, c } = initVal();
  let selectCalls = 0;
  const modules: ValModule<SelectorSource>[] = [];
  const mountedPaths: string[] = [];

  for (let m = 0; m < size.plainModules; m++) {
    const path = `/page-${m}.val.ts`;
    const items: Record<string, ReturnType<typeof s.string>> = {};
    const source: Record<string, string> = {};
    for (let f = 0; f < size.fieldsPerModule; f++) {
      items[`field${f}`] = s.string().minLength(2);
      source[`field${f}`] = `page ${m} field ${f}`;
    }
    modules.push(c.define(path, s.object(items), source));
    // Two fields per module mounted: enough that a keystroke has neighbours to
    // (wrongly) wake, which is the fan-out being measured.
    mountedPaths.push(`${path}?p="field0"`, `${path}?p="field1"`);
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
        s
          .array(s.object({ title: s.string().minLength(2), body: s.string() }))
          .render({
            as: "list",
            select: ({ val }) => {
              selectCalls++;
              return { title: val.title, subtitle: val.body };
            },
          }),
        rows,
      ),
    );
    mountedPaths.push(`${path}?p=0`);
  }

  const nestedModule = "/handbook.val.ts";
  modules.push(
    c.define(
      nestedModule,
      s
        .array(
          s.object({
            title: s.string().minLength(2),
            sections: s
              .array(s.object({ heading: s.string().minLength(2) }))
              .render({
                as: "list",
                select: ({ val }) => {
                  selectCalls++;
                  return { title: val.heading };
                },
              }),
          }),
        )
        .render({
          as: "list",
          select: ({ val }) => {
            selectCalls++;
            return { title: val.title };
          },
        }),
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
