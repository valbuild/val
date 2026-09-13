import {
  canUndo,
  closeOverRequired,
  consequenceOfUndoing,
} from "./undoSelection";
import type { CompareModel, ComparePane } from "./types";

/**
 * What a pick actually takes with it.
 *
 * This is the part of undo that is a property rather than a layout, and the one
 * with a real cost when it is wrong: the prefix invariant means discarding a
 * patch out of the middle of a set "either errors or silently writes to the
 * wrong index", so a closure that stops one short is a silently corrupted
 * array — which is exactly the failure the invariant exists to prevent.
 */
describe("closeOverRequired", () => {
  test("follows a chain to the end", () => {
    // a → b → c. Picking a must reach c: `requires` chains, and stopping at b
    // would leave c applying against a state that no longer exists.
    const requires = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["c"]],
    ]);

    const res = closeOverRequired(new Set(["a"]), requires);

    expect([...res.selected].sort()).toEqual(["a", "b", "c"]);
    expect([...res.pulledIn].sort()).toEqual(["b", "c"]);
  });

  test("an explicit pick is never reported as pulled in", () => {
    // The confirmation distinguishes "this change" from "and 2 later ones", and
    // a row that is both is the user's own choice.
    const requires = new Map<string, string[]>([["a", ["b"]]]);

    const res = closeOverRequired(new Set(["a", "b"]), requires);

    expect([...res.selected].sort()).toEqual(["a", "b"]);
    expect([...res.pulledIn]).toEqual([]);
  });

  test("a cycle terminates instead of hanging", () => {
    // Cannot arise from a patch chain, but a malformed adapter must produce a
    // wrong answer rather than a frozen tab.
    const requires = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);

    const res = closeOverRequired(new Set(["a"]), requires);

    expect([...res.selected].sort()).toEqual(["a", "b"]);
  });
});

/**
 * A one-pane model.
 *
 * `consequenceOfUndoing` takes a MODEL rather than a pane. A `requires` edge
 * stays within a module in practice — a patch set is scoped to one — but
 * nothing in the closure depends on that, and taking the model means nothing
 * would notice if it stopped holding.
 */
function modelWith(
  rows: {
    id: string;
    requires?: string[];
    authors?: Record<string, never[]>;
  }[],
): CompareModel {
  const pane: ComparePane = {
    title: "t",
    groups: [
      {
        kind: "fields",
        id: "g",
        rows: rows.map((row) => ({
          id: row.id,
          label: row.id,
          change: "changed",
          authors: row.authors,
          undo: { kind: "discard", requires: row.requires },
        })),
      },
    ],
  };
  return {
    sections: [
      {
        id: "s",
        title: "S",
        nodes: [{ id: "n", label: "n", kind: "module", change: "changed" }],
      },
    ],
    panes: { n: pane },
    left: { label: "L" },
    right: { label: "R" },
    basisOptions: [],
    selectedBasisId: "b",
    changeCount: rows.length,
    profiles: {},
    undo: { kind: "discard" },
  };
}

/**
 * What one click actually takes with it, and whose work that is.
 *
 * The whole reason a closure is computed at all: undoing your own change can be
 * legal only if a colleague's later change goes with it, and that has to be
 * said before the click rather than discovered after it.
 */
describe("consequenceOfUndoing", () => {
  test("names other people whose work the closure dragged in", () => {
    const model = modelWith([
      { id: "mine", requires: ["theirs"], authors: { ada: [] } },
      { id: "theirs", authors: { linus: [] } },
    ]);

    const res = consequenceOfUndoing("mine", model, "ada");

    expect(res.ids.sort()).toEqual(["mine", "theirs"]);
    expect(res.pulledIn).toBe(1);
    expect(res.others).toEqual(["linus"]);
  });

  test("does not warn about your own dependent changes", () => {
    const model = modelWith([
      { id: "first", requires: ["second"], authors: { ada: [] } },
      { id: "second", authors: { ada: [] } },
    ]);

    const res = consequenceOfUndoing("first", model, "ada");

    expect(res.pulledIn).toBe(1);
    expect(res.others).toEqual([]);
  });

  test("a row that compels nothing takes nothing with it", () => {
    // The common case, and the one the confirmation wording branches on: with
    // no dependents it reads "Discard this change?" rather than naming a count.
    const model = modelWith([
      { id: "alone", authors: { ada: [] } },
      { id: "unrelated", authors: { linus: [] } },
    ]);

    const res = consequenceOfUndoing("alone", model, "ada");

    expect(res.ids).toEqual(["alone"]);
    expect(res.pulledIn).toBe(0);
    expect(res.others).toEqual([]);
  });

  test("the ids are the closure, not just the row", () => {
    // `ids` is both what the confirmation counts and what is actually undone.
    // A count computed separately from the set is how the two drift apart.
    const model = modelWith([
      { id: "a", requires: ["b"] },
      { id: "b", requires: ["c"] },
      { id: "c" },
    ]);

    expect(consequenceOfUndoing("a", model, null).ids.sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

/**
 * Which rows offer an action at all.
 *
 * A revert the schema refuses is shown with its reason instead: there is
 * nothing a click could do, and a control that never explains itself is worse
 * than no control.
 */
describe("canUndo", () => {
  test("refuses a revert the schema cannot take", () => {
    expect(canUndo({ kind: "revert", compatibility: "no" })).toBe(false);
  });

  test("offers an unknown revert, because the real check runs at confirm", () => {
    expect(canUndo({ kind: "revert", compatibility: "unknown" })).toBe(true);
  });

  test("offers a compatible revert and any discard", () => {
    expect(canUndo({ kind: "revert", compatibility: "yes" })).toBe(true);
    expect(canUndo({ kind: "discard" })).toBe(true);
  });

  test("a row with no undo descriptor has nothing to offer", () => {
    expect(canUndo(undefined)).toBe(false);
  });
});
