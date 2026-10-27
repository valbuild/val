/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { initVal, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { PathNode } from "../utils/pathTree";
import { Remote } from "../utils/Remote";

/**
 * Which modules the nav's Explorer lists.
 *
 * `hidden` on a module's ROOT schema is the one flag whose meaning had to be
 * decided rather than inherited: a module has no parent to be hidden FROM, so
 * it can only mean "do not list this". The module stays navigable — an
 * `s.view()` row, a search hit and a validation error all lead to it — and
 * `Module` renders it in full once you are there.
 */
let mockSchemas: Remote<Record<ModuleFilePath, SerializedSchema>> = {
  status: "loading",
};

jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useSchemas: () => mockSchemas,
}));

import { useTrees } from "./useTrees";

const { s } = initVal();

function mount(schemas: Record<string, SerializedSchema>) {
  mockSchemas = {
    status: "success",
    data: schemas as Record<ModuleFilePath, SerializedSchema>,
  };
  return renderHook(() => useTrees()).result.current;
}

/** Every module file the tree holds, flattened and sorted. */
function filesOf(node: PathNode): string[] {
  const out: string[] = [];
  const walk = (n: PathNode): void => {
    if (!n.isDirectory) {
      out.push(n.fullPath);
    }
    for (const child of n.children) {
      walk(child);
    }
  };
  walk(node);
  return out.sort();
}

const page = s.object({ title: s.string() })["executeSerialize"]();
const employees = s
  .record(s.object({ name: s.string() }))
  ["executeSerialize"]();
const hiddenEmployees = s
  .record(s.object({ name: s.string() }))
  .hidden()
  ["executeSerialize"]();

describe("useTrees", () => {
  test("lists every module that is not hidden", () => {
    const trees = mount({
      "/app/menneskene/page.val.ts": page,
      "/data/employees.val.ts": employees,
    });
    expect(trees.status).toBe("success");
    if (trees.status !== "success") return;
    expect(filesOf(trees.data.root)).toEqual([
      "/app/menneskene/page.val.ts",
      "/data/employees.val.ts",
    ]);
  });

  test("a module whose root schema is hidden is not listed", () => {
    const trees = mount({
      "/app/menneskene/page.val.ts": page,
      "/data/employees.val.ts": hiddenEmployees,
    });
    expect(trees.status).toBe("success");
    if (trees.status !== "success") return;
    expect(filesOf(trees.data.root)).toEqual(["/app/menneskene/page.val.ts"]);
  });

  /**
   * Filtered before the tree is built, not after. Pruning at render would have
   * left `/data` behind as a folder an editor can open and find nothing in.
   */
  test("the directory a hidden module was alone in goes with it", () => {
    const trees = mount({
      "/app/menneskene/page.val.ts": page,
      "/data/employees.val.ts": hiddenEmployees,
    });
    expect(trees.status).toBe("success");
    if (trees.status !== "success") return;
    expect(trees.data.root.children.map((child) => child.fullPath)).toEqual([
      "/app",
    ]);
  });

  /**
   * A router record belongs to the Pages tree, never to the Explorer. Written
   * as the wire form rather than built with `.router(nextAppRouter)`, because
   * that is what the Studio is handed — and the router exports are not
   * reachable from this package's jest resolution.
   */
  test("routers are kept apart from the module tree", () => {
    const trees = mount({
      "/app/blogs/[blog]/page.val.ts": {
        ...s.record(s.object({ title: s.string() }))["executeSerialize"](),
        router: "next-app-router",
      },
      "/data/employees.val.ts": employees,
    });
    expect(trees.status).toBe("success");
    if (trees.status !== "success") return;
    expect(filesOf(trees.data.root)).toEqual(["/data/employees.val.ts"]);
    expect(trees.data.routers["next-app-router"]).toEqual([
      "/app/blogs/[blog]/page.val.ts",
    ]);
  });
});
