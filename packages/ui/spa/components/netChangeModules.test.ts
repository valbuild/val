import type { ModuleFilePath } from "@valbuild/core";
import { netChangeModules } from "./netChangeModules";

const page = "/app/page.val.ts" as ModuleFilePath;
const footer = "/app/footer.val.ts" as ModuleFilePath;
const records = (...entries: [string, ModuleFilePath][]) =>
  entries.map(([patchId, moduleFilePath]) => ({ patchId, moduleFilePath }));

describe("netChangeModules", () => {
  test("compares every module with unpublished work", () => {
    expect(
      netChangeModules(
        records(["p1", page], ["p2", footer]),
        new Set(),
        new Set(),
      ),
    ).toEqual({ compare: [page, footer], changesOnPublishing: false });
  });

  test("leaves out what has shipped", () => {
    expect(
      netChangeModules(
        records(["p1", page], ["p2", footer]),
        new Set(["p1"]),
        new Set(),
      ),
    ).toEqual({ compare: [footer], changesOnPublishing: false });
  });

  /*
   * p1 (A→B) is publishing and p2 (B→A) was saved since. The chain nets to A,
   * which is what is published, so the module read as "reverted" and Publish
   * went off -- over the one change that undoes B once p1 lands.
   */
  test("a change to a module a running publish is changing counts as a change", () => {
    expect(
      netChangeModules(
        records(["p1", page], ["p2", page]),
        new Set(),
        new Set(["p1"]),
      ),
    ).toEqual({ compare: [], changesOnPublishing: true });
  });

  test("a module only a running publish touches is not compared", () => {
    expect(
      netChangeModules(
        records(["p1", page], ["p2", footer]),
        new Set(),
        new Set(["p1"]),
      ),
    ).toEqual({ compare: [footer], changesOnPublishing: false });
  });
});
