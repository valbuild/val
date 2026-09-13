import {
  closeOverRequired,
  isSelectable,
  summarizeUndo,
} from "./undoSelection";
import type { ComparePane } from "./types";

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
    // The bar distinguishes "you chose this" from "this had to come too", and
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

function paneWith(
  rows: {
    id: string;
    requires?: string[];
    authors?: Record<string, never[]>;
  }[],
): ComparePane {
  return {
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
}

describe("summarizeUndo", () => {
  test("names other people whose work the closure dragged in", () => {
    // The consequence nobody expects: discarding your own change is legal only
    // if a colleague's later change goes with it. That has to be said before
    // the click.
    const pane = paneWith([
      { id: "mine", requires: ["theirs"], authors: { ada: [] } },
      { id: "theirs", authors: { linus: [] } },
    ]);

    const res = summarizeUndo(new Set(["mine"]), pane, "ada");

    expect([...res.pulledIn]).toEqual(["theirs"]);
    expect(res.othersAffected).toEqual(["linus"]);
  });

  test("does not warn about your own dependent changes", () => {
    const pane = paneWith([
      { id: "first", requires: ["second"], authors: { ada: [] } },
      { id: "second", authors: { ada: [] } },
    ]);

    const res = summarizeUndo(new Set(["first"]), pane, "ada");

    expect([...res.pulledIn]).toEqual(["second"]);
    expect(res.othersAffected).toEqual([]);
  });
});

describe("isSelectable", () => {
  test("a revert the schema refuses cannot be picked", () => {
    // Shown with its reason instead. A disabled control that never explains
    // itself is worse than no control.
    expect(isSelectable({ kind: "revert", compatibility: "no" })).toBe(false);
  });

  test("an unknown compatibility is offered", () => {
    // `checkCompatibility` cannot see the value, so refusing on `unknown` would
    // block restores that are fine. The value-level gate runs at confirm.
    expect(isSelectable({ kind: "revert", compatibility: "unknown" })).toBe(
      true,
    );
  });

  test("a row with no undo descriptor is not selectable", () => {
    expect(isSelectable(undefined)).toBe(false);
  });
});
