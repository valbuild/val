/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { useNoOpSourcePaths } from "./ValProvider";

/**
 * A held change is not a reverted one.
 *
 * `useNoOpSourcePaths` answers "did this path end up back where it started",
 * and the review screen files everything it names under "reverted" — a
 * collapsed section that says the content matches what is published and offers
 * only Discard.
 *
 * It answers by comparing the DISPLAYED source against base, and a scoped
 * client does not display patches outside its group. So a path whose one
 * pending change is held back looked exactly like one whose change was undone.
 * That is the worst possible confusion to make: the review screen is the one
 * place a held change can be put back from, and it was telling its author the
 * change was gone while offering to throw it away.
 *
 * Found by driving the real Studio — `e2e/http/patchGroups.spec.ts` unstages a
 * change and then tries to stage it again. Nothing below the UI could see it:
 * the store was right, the scope was right, and the screen still said reverted.
 */

const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
const NAME = '/content/authors.val.ts?p="teddy"."name"' as SourcePath;
const HELD = "held-patch" as PatchId;

type HeldPatch = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Patch;
};

/** A held patch whose one op is at `patchPath` in `moduleFilePath`. */
function heldAt(
  patchId: PatchId,
  moduleFilePath: ModuleFilePath,
  op: "replace" | "add",
  patchPath: string[],
): HeldPatch {
  return {
    patchId,
    moduleFilePath,
    patch: [{ op, path: patchPath, value: "held" }],
  };
}

function systemWith(options: {
  /** What each path currently displays. */
  after: Record<string, unknown>;
  /** What each path displayed before any pending patch. */
  before: Record<string, unknown>;
  held: HeldPatch[];
}) {
  const noEvents = { on: () => () => {} };
  const byId = new Map(options.held.map((held) => [held.patchId, held]));
  return {
    system: {
      sourceStore: {
        events: noEvents,
        sourcesVersion: () => 1,
        peek: (path: SourcePath) => ({
          status: "ready",
          data: options.after[path],
        }),
        peekBase: (path: SourcePath) => ({
          status: "ready",
          data: options.before[path],
        }),
      },
      patchStore: {
        events: noEvents,
        chainVersion: () => 1,
        heldPatchIds: () => new Set(byId.keys()),
        recordsFor: (patchIds: readonly PatchId[]) =>
          patchIds.flatMap((patchId) => {
            const held = byId.get(patchId);
            return held === undefined ? [] : [held];
          }),
      },
    },
  };
}

// `mock`-prefixed so jest allows the factory below to close over it.
let mockCurrent: ReturnType<typeof systemWith> | null = null;
/*
 * `ValProvider` imports the system factory, which reaches an ESM-only module
 * jest cannot require. Nothing on this path calls it — the system here is a
 * stub — so it is replaced rather than loaded. Without this the suite cannot
 * even be imported, which is why no other test reaches into `ValProvider`.
 */
jest.mock("../stores/react/createValSystem", () => ({
  __esModule: true,
  createValSystem: () => {
    throw new Error("not used in this test");
  },
}));
jest.mock("../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => mockCurrent,
}));

function noOpPaths(
  options: Parameters<typeof systemWith>[0],
  paths: SourcePath[] = [NAME],
): Set<SourcePath> {
  mockCurrent = systemWith(options);
  const { result } = renderHook(() => useNoOpSourcePaths(paths));
  return new Set(result.current);
}

test("a path whose change was undone is a no-op", () => {
  // Nothing held: the two sides really are equal, and "reverted" is the right
  // answer. This is the case the classification exists for.
  expect(
    noOpPaths({
      after: { [NAME]: "Theodor René Carlsen" },
      before: { [NAME]: "Theodor René Carlsen" },
      held: [],
    }),
  ).toContain(NAME);
});

test("a path whose only change is HELD is not a no-op", () => {
  /*
   * The same two values, and the same comparison — which is exactly why the
   * comparison alone cannot tell these apart. The difference is that a patch
   * exists and is being hidden, so the change is pending, not gone.
   */
  expect(
    noOpPaths({
      after: { [NAME]: "Theodor René Carlsen" },
      before: { [NAME]: "Theodor René Carlsen" },
      held: [heldAt(HELD, AUTHORS, "replace", ["teddy", "name"])],
    }),
  ).not.toContain(NAME);
});

test("a path with a visible change is not a no-op either way", () => {
  expect(
    noOpPaths({
      after: { [NAME]: "Ada was here" },
      before: { [NAME]: "Theodor René Carlsen" },
      held: [],
    }),
  ).not.toContain(NAME);
});

const PAGE = "/content/page.val.ts" as ModuleFilePath;
const TITLE = '/content/page.val.ts?p="title"' as SourcePath;
const ITEMS = '/content/page.val.ts?p="items"' as SourcePath;

test("a held patch hides only the paths it touches, not its whole module", () => {
  /*
   * Bob holds an insert into `?items`; Alice typed `?title` back to what it
   * already said. They share a module and nothing else.
   *
   * Excluding per MODULE — the first shape of this fix — took `?title` out of
   * the comparison because SOMETHING in the module was held, so a field that
   * really is back where it started was listed as a live change, and Alice
   * could not clear it off her review screen. `?items` still has to stay out:
   * that one is held, and hidden, and its two sides compare equal for that
   * reason alone.
   */
  const noOps = noOpPaths(
    {
      after: { [TITLE]: "Hello", [ITEMS]: ["a", "b"] },
      before: { [TITLE]: "Hello", [ITEMS]: ["a", "b"] },
      held: [heldAt("bobs-insert" as PatchId, PAGE, "add", ["items", "0"])],
    },
    [TITLE, ITEMS],
  );
  expect(noOps).toContain(TITLE);
  expect(noOps).not.toContain(ITEMS);
});

test("a held change deep inside a path hides the path above it too", () => {
  /*
   * `?items/0/title` held means `?items` displays base as well, so `?items`
   * compares equal for the same hidden reason and would be misread the same
   * way. The containment test therefore runs in both directions.
   */
  const DEEP = '/content/page.val.ts?p="items".0."title"' as SourcePath;
  const noOps = noOpPaths(
    {
      after: { [ITEMS]: ["a"], [DEEP]: "a" },
      before: { [ITEMS]: ["a"], [DEEP]: "a" },
      held: [
        heldAt("bobs-edit" as PatchId, PAGE, "replace", [
          "items",
          "0",
          "title",
        ]),
      ],
    },
    [ITEMS, DEEP],
  );
  expect(noOps).not.toContain(ITEMS);
  expect(noOps).not.toContain(DEEP);
});

test("a held change in ANOTHER module does not hide a lookalike prefix", () => {
  /*
   * `/content/authors.val.ts` is a textual prefix of
   * `/content/authorsExtra.val.ts`. A plain `startsWith` would let a held patch
   * in one silence a reverted field in the other — the same boundary bug that
   * `isPathWithin` exists for.
   */
  const EXTRA = "/content/authorsExtra.val.ts" as ModuleFilePath;
  const EXTRA_NAME = '/content/authorsExtra.val.ts?p="name"' as SourcePath;
  expect(
    noOpPaths(
      {
        after: { [EXTRA_NAME]: "Ada" },
        before: { [EXTRA_NAME]: "Ada" },
        held: [heldAt(HELD, AUTHORS, "replace", ["teddy", "name"])],
      },
      [EXTRA_NAME],
    ),
  ).toContain(EXTRA_NAME);
  // …and the module it IS in is still hidden.
  expect(
    noOpPaths(
      {
        after: { [NAME]: "Teddy" },
        before: { [NAME]: "Teddy" },
        held: [heldAt(HELD, EXTRA, "replace", ["name"])],
      },
      [NAME],
    ),
  ).toContain(NAME);
});
