/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import { useNoOpSourcePaths } from "./ValProvider";

/**
 * A held change is not a reverted one.
 *
 * `useNoOpSourcePaths` answers "did this module end up back where it started",
 * and the review screen files everything it names under "reverted" — a
 * collapsed section that says the content matches what is published and offers
 * only Discard.
 *
 * It answers by comparing the DISPLAYED source against base, and a scoped
 * client does not display patches outside its group. So a module whose one
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

function systemWith(options: {
  /** What the module currently displays. */
  after: unknown;
  /** What it displayed before any pending patch. */
  before: unknown;
  heldPatchIds: PatchId[];
}) {
  const noEvents = { on: () => () => {} };
  return {
    system: {
      sourceStore: {
        events: noEvents,
        sourcesVersion: () => 1,
        peek: () => ({ status: "ready", data: options.after }),
        peekBase: () => ({ status: "ready", data: options.before }),
      },
      patchStore: {
        events: noEvents,
        chainVersion: () => 1,
        heldPatchIds: () => new Set(options.heldPatchIds),
        recordsFor: (patchIds: readonly PatchId[]) =>
          patchIds.map((patchId) => ({
            patchId,
            moduleFilePath: AUTHORS,
            patch: [],
          })),
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

function noOpPaths(options: Parameters<typeof systemWith>[0]): Set<SourcePath> {
  mockCurrent = systemWith(options);
  const { result } = renderHook(() => useNoOpSourcePaths([NAME]));
  return new Set(result.current);
}

test("a module whose change was undone is a no-op", () => {
  // Nothing held: the two sides really are equal, and "reverted" is the right
  // answer. This is the case the classification exists for.
  expect(
    noOpPaths({
      after: "Theodor René Carlsen",
      before: "Theodor René Carlsen",
      heldPatchIds: [],
    }),
  ).toContain(NAME);
});

test("a module whose only change is HELD is not a no-op", () => {
  /*
   * The same two values, and the same comparison — which is exactly why the
   * comparison alone cannot tell these apart. The difference is that a patch
   * exists and is being hidden, so the change is pending, not gone.
   */
  expect(
    noOpPaths({
      after: "Theodor René Carlsen",
      before: "Theodor René Carlsen",
      heldPatchIds: [HELD],
    }),
  ).not.toContain(NAME);
});

test("a module with a visible change is not a no-op either way", () => {
  expect(
    noOpPaths({
      after: "Ada was here",
      before: "Theodor René Carlsen",
      heldPatchIds: [],
    }),
  ).not.toContain(NAME);
});
