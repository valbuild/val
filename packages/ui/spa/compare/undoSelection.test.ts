import {
  aggregateOf,
  closeOverRequired,
  dropRequiring,
  isSelectable,
  summarizeUndo,
  toggleMany,
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

/**
 * A one-pane model.
 *
 * `summarizeUndo` takes a MODEL rather than a pane: nav-level controls select
 * across panes, so the closure and the "whose work did this drag in" question
 * are model-wide.
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

describe("summarizeUndo", () => {
  test("names other people whose work the closure dragged in", () => {
    // The consequence nobody expects: discarding your own change is legal only
    // if a colleague's later change goes with it. That has to be said before
    // the click.
    const model = modelWith([
      { id: "mine", requires: ["theirs"], authors: { ada: [] } },
      { id: "theirs", authors: { linus: [] } },
    ]);

    const res = summarizeUndo(new Set(["mine"]), model, "ada");

    expect([...res.pulledIn]).toEqual(["theirs"]);
    expect(res.othersAffected).toEqual(["linus"]);
  });

  test("does not warn about your own dependent changes", () => {
    const model = modelWith([
      { id: "first", requires: ["second"], authors: { ada: [] } },
      { id: "second", authors: { ada: [] } },
    ]);

    const res = summarizeUndo(new Set(["first"]), model, "ada");

    expect([...res.pulledIn]).toEqual(["second"]);
    expect(res.othersAffected).toEqual([]);
  });
});

/**
 * Unticking, which is the closure read backwards.
 *
 * If picking `a` forces `b`, then refusing `b` refuses `a` — but ONLY `a`. The
 * earlier version cleared the whole selection, which was never wrong and was
 * always annoying: it threw away picks that had nothing to do with the row
 * being unticked.
 */
describe("dropRequiring", () => {
  test("drops the pick that compelled the unticked row", () => {
    const requires = new Map<string, string[]>([["a", ["b"]]]);

    const res = dropRequiring(new Set(["a"]), "b", requires);

    expect([...res]).toEqual([]);
  });

  test("leaves unrelated picks alone", () => {
    // The whole point. `x` cannot reach `b`, so refusing `b` says nothing
    // about it.
    const requires = new Map<string, string[]>([["a", ["b"]]]);

    const res = dropRequiring(new Set(["a", "x"]), "b", requires);

    expect([...res]).toEqual(["x"]);
  });

  test("follows the chain backwards through an intermediate", () => {
    // a → b → c. Refusing c must refuse a as well, not just b — a still
    // compels c transitively, so leaving it would put c straight back.
    const requires = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["c"]],
    ]);

    const res = dropRequiring(new Set(["a"]), "c", requires);

    expect([...res]).toEqual([]);
  });

  test("unticking an explicit pick that another pick also requires drops both", () => {
    // Otherwise the next render puts the row back and the click looks ignored.
    const requires = new Map<string, string[]>([["a", ["b"]]]);

    const res = dropRequiring(new Set(["a", "b"]), "b", requires);

    expect([...res]).toEqual([]);
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

/**
 * Aggregate state for a nav row or a group heading.
 *
 * Three states rather than two, because two would lie: a heading whose list is
 * half selected has to say so, or ticking it looks like it did nothing and
 * unticking it looks like it did too much.
 */
describe("aggregateOf", () => {
  test("reports none, some and all", () => {
    const ids = ["a", "b"];
    expect(aggregateOf(ids, new Set())).toBe("none");
    expect(aggregateOf(ids, new Set(["a"]))).toBe("some");
    expect(aggregateOf(ids, new Set(["a", "b"]))).toBe("all");
  });

  test("an empty set is none, not all", () => {
    // A nav row with nothing selectable under it must not render as ticked —
    // `[].every(...)` is `true`, which is the trap this guards.
    expect(aggregateOf([], new Set(["a"]))).toBe("none");
  });
});

describe("toggleMany", () => {
  test("ticking adds every id", () => {
    const res = toggleMany(new Set(["x"]), ["a", "b"], true, new Map());
    expect([...res].sort()).toEqual(["a", "b", "x"]);
  });

  test("unticking also drops a pick from OUTSIDE the set that compelled one inside it", () => {
    // `outsider` requires `a`. Unticking the group containing `a` has to drop
    // `outsider` too, or the next render puts `a` straight back and the click
    // looks ignored.
    const requires = new Map<string, string[]>([["outsider", ["a"]]]);

    const res = toggleMany(
      new Set(["outsider", "a"]),
      ["a", "b"],
      false,
      requires,
    );

    expect([...res]).toEqual([]);
  });

  test("unticking leaves unrelated picks alone", () => {
    const res = toggleMany(new Set(["a", "keep"]), ["a"], false, new Map());
    expect([...res]).toEqual(["keep"]);
  });
});
