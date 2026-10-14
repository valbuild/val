import { initVal, type ModuleFilePath } from "@valbuild/core";
import type { HistoricalModule } from "@valbuild/shared/internal";
import { planGoBack } from "./goBack";

const { s } = initVal();

/**
 * "Go back to this point": every module whose content differs from what it
 * was at the commit is put back whole (valbuild/home
 * `docs/hosted-publishing.md`, step 9).
 */
describe("going back to a point", () => {
  const schema = s.object({ title: s.string() })["executeSerialize"]();
  const at = (title: string): HistoricalModule => ({
    schema,
    source: { title },
    patchIds: [],
    changedPaths: [],
    failures: [],
  });
  const HOME = "/content/home.val.ts" as ModuleFilePath;
  const ABOUT = "/content/about.val.ts" as ModuleFilePath;
  const NEWS = "/content/news.val.ts" as ModuleFilePath;

  test("puts back what changed since, and leaves what did not", () => {
    const plan = planGoBack([
      { moduleFilePath: HOME, atCommit: at("Then"), now: { title: "Now" } },
      { moduleFilePath: ABOUT, atCommit: at("Same"), now: { title: "Same" } },
    ]);
    expect(plan.modules).toEqual([
      {
        moduleFilePath: HOME,
        patch: [{ op: "replace", path: [], value: { title: "Then" } }],
      },
    ]);
    expect(plan.unchanged).toEqual([ABOUT]);
  });

  test("a module history has no record of is left as it is, and said", () => {
    const plan = planGoBack([
      { moduleFilePath: NEWS, atCommit: null, now: { title: "Now" } },
    ]);
    expect(plan.modules).toEqual([]);
    expect(plan.unrecorded).toEqual([NEWS]);
  });

  test("a module not loaded yet is put back rather than guessed equal", () => {
    const plan = planGoBack([
      { moduleFilePath: HOME, atCommit: at("Then"), now: undefined },
    ]);
    expect(plan.modules.map((m) => m.moduleFilePath)).toEqual([HOME]);
  });

  test("the same commit plans the same patches in the same order", () => {
    const modules = [
      { moduleFilePath: HOME, atCommit: at("a"), now: { title: "b" } },
      { moduleFilePath: ABOUT, atCommit: at("a"), now: { title: "b" } },
    ];
    expect(planGoBack(modules).modules.map((m) => m.moduleFilePath)).toEqual([
      ABOUT,
      HOME,
    ]);
    expect(planGoBack([...modules].reverse())).toEqual(planGoBack(modules));
  });

  test("a module saved by another Val is blocked, with the reason", () => {
    const plan = planGoBack([
      {
        moduleFilePath: HOME,
        atCommit: { ...at("Then"), schema: null },
        now: { title: "Now" },
      },
    ]);
    expect(plan.blocked).toEqual([
      { moduleFilePath: HOME, reason: expect.any(String) },
    ]);
  });

  test("with the code, every module is written, equal to now or not", () => {
    const plan = planGoBack(
      [{ moduleFilePath: ABOUT, atCommit: at("Same"), now: { title: "Same" } }],
      undefined,
      { everyModule: true },
    );
    expect(plan.modules.map((m) => m.moduleFilePath)).toEqual([ABOUT]);
    expect(plan.unchanged).toEqual([]);
  });
});
