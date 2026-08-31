/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { PatchId } from "@valbuild/core";
import { StagingBulkActions } from "./StagingToggle";
import { PatchStagingProvider } from "./PatchStagingProvider";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { Profile } from "./ValProvider";
import { TooltipProvider } from "./designSystem/tooltip";

/**
 * The bulk stage / unstage buttons.
 *
 * What is worth pinning is not that a button renders — it is WHICH ids each one
 * sends. A bulk button that acts on the wrong set publishes somebody else's
 * unfinished work, and nothing on screen would say so.
 *
 * Driven through the real `PatchStagingProvider` rather than a stubbed context,
 * so the closure runs for real: a per-author button is only trustworthy if what
 * it sends survives the same prefix rules as a row toggle.
 */

const PROFILES = {
  alice: { fullName: "Alice Andersen" },
  bob: { fullName: "Bob Bakke" },
} as unknown as Record<string, Profile>;

/** One patch set per path, so each patch stages and unstages independently. */
function patchSets(
  entries: { path: string; patchId: string; author: string }[],
): SerializedPatchSet {
  return entries.map(({ path, patchId, author }) => ({
    moduleFilePath: "/content/p.val.ts",
    patchPath: [path],
    patches: [
      {
        patchId,
        createdAt: "2026-01-01T00:00:00Z",
        author,
      },
    ],
  })) as unknown as SerializedPatchSet;
}

const SETS = patchSets([
  { path: "a", patchId: "p1", author: "alice" },
  { path: "b", patchId: "p2", author: "bob" },
  { path: "c", patchId: "p3", author: "bob" },
]);
const CHAIN = ["p1", "p2", "p3"] as PatchId[];

function Harness({
  side,
  initialGroup = CHAIN,
  ids = CHAIN,
  onChange,
}: {
  side: "staged" | "held";
  initialGroup?: PatchId[];
  ids?: PatchId[];
  onChange?: (next: Set<PatchId>) => void;
}) {
  const [group, setGroup] = useState<Set<PatchId>>(new Set(initialGroup));
  return (
    <TooltipProvider>
      <PatchStagingProvider
        enabled
        patchSets={SETS}
        chainOrder={CHAIN}
        group={group}
        onChange={(next) => {
          setGroup(next);
          onChange?.(next);
        }}
      >
        <StagingBulkActions
          patchIds={ids}
          profilesByAuthorIds={PROFILES}
          side={side}
        />
      </PatchStagingProvider>
    </TooltipProvider>
  );
}

test("the staged section offers unstage, the unstaged section offers stage", () => {
  const { unmount } = render(<Harness side="staged" />);
  expect(screen.getByRole("button", { name: /^Unstage all/ })).toBeTruthy();
  unmount();
  render(<Harness side="held" initialGroup={[]} />);
  expect(screen.getByRole("button", { name: /^Stage all/ })).toBeTruthy();
});

test("'all' moves every id in the section", () => {
  let latest: Set<PatchId> | null = null;
  render(<Harness side="staged" onChange={(next) => (latest = next)} />);
  fireEvent.click(screen.getByRole("button", { name: /^Unstage all/ }));
  expect(latest && [...latest]).toEqual([]);
});

test("a per-author button moves only that author's ids", () => {
  let latest: Set<PatchId> | null = null;
  render(
    <Harness
      side="held"
      initialGroup={[]}
      onChange={(next) => (latest = next)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /by Bob Bakke/ }));
  // Bob's two come back; Alice's stays held. That distinction is the whole control.
  expect(latest && [...latest].sort()).toEqual(["p2", "p3"]);
});

test("per-author buttons are counted and named", () => {
  render(<Harness side="held" initialGroup={[]} />);
  expect(screen.getByText("Stage Bob Bakke's 2")).toBeTruthy();
  expect(screen.getByText("Stage Alice Andersen's 1")).toBeTruthy();
});

test("UNSTAGING is never offered per author, only in bulk", () => {
  /*
   * Asymmetric on purpose. Staging by author is how you put your OWN work back.
   * "Unstage everything Bob wrote" is a judgement about somebody else's work made
   * in one click across places you have not looked — the row control already
   * covers the case where you looked and decided.
   */
  render(<Harness side="staged" />);
  expect(screen.queryByText(/Unstage Bob Bakke's/)).toBeNull();
  expect(screen.queryByText(/Unstage Alice Andersen's/)).toBeNull();
  expect(screen.getByRole("button", { name: /^Unstage all/ })).toBeTruthy();
});

test("with a single author there is no per-author button", () => {
  // "Stage all" already says exactly the same thing, and two controls doing
  // one job is worse than one.
  render(
    <Harness side="held" initialGroup={[]} ids={["p2", "p3"] as PatchId[]} />,
  );
  expect(screen.queryByText(/Stage Bob Bakke's/)).toBeNull();
  expect(screen.getByRole("button", { name: /^Stage all/ })).toBeTruthy();
});

test("an empty section renders nothing", () => {
  const { container } = render(<Harness side="held" ids={[]} />);
  expect(container.textContent).toBe("");
});
