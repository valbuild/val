import { initVal, ModuleFilePath, PatchId } from "@valbuild/core";
import { Operation } from "@valbuild/core/patch";
import { PatchSets } from "./PatchSets";
import {
  editWouldRestage,
  heldPatchSets,
  holdsRegionOf,
  inChainOrder,
  indexPatchSets,
  stageClosure,
  unstageClosure,
  validateGroup,
} from "./patchGroups";

const { s } = initVal();

/**
 * Unit tests for the staging primitives.
 *
 * `patchGroups.test.ts` covers behaviour end to end by replaying edits and
 * applying the result. These are the narrow tests for each function's own
 * contract, so a failure points at one place rather than at a whole scenario.
 */

const page = s.object({
  title: s.string(),
  items: s.array(s.object({ title: s.string() })),
});
const MODULE = "/content/page.val.ts" as ModuleFilePath;

function index(patches: { id: string; ops: Operation[] }[]) {
  const patchSets = new PatchSets();
  patches.forEach((patch, i) => {
    patchSets.insert(
      MODULE,
      page["executeSerialize"](),
      patch.ops,
      patch.id as PatchId,
      `2024-01-0${i + 1}T00:00:00.000Z`,
      "author",
    );
  });
  return indexPatchSets(
    patchSets.serialize(),
    patches.map((p) => p.id as PatchId),
  );
}

const ids = (...values: string[]) => new Set(values as PatchId[]);

// Three edits: two in separate leaf patch sets, one covering the whole array.
const arrayChain = () =>
  index([
    { id: "p1", ops: [{ op: "replace", path: ["title"], value: "T" }] },
    {
      id: "p2",
      ops: [{ op: "replace", path: ["items", "0", "title"], value: "A*" }],
    },
    {
      id: "p3",
      ops: [{ op: "add", path: ["items", "2"], value: { title: "C" } }],
    },
  ]);

describe("indexPatchSets", () => {
  test("orders each patch set by chain position, not by display order", () => {
    // `SerializedPatchSet` is newest-first because the compare view renders
    // newest-first. The prefix invariant is only meaningful in chain order, so the
    // index has to flip it exactly once, here.
    const i = arrayChain();
    const items = i.sets[i.labels.indexOf(`${MODULE}?items`)];
    expect(items).toEqual(["p2", "p3"]);
  });

  test("rejects a patch set member that is missing from the chain order", () => {
    const patchSets = new PatchSets();
    patchSets.insert(
      MODULE,
      page["executeSerialize"](),
      [{ op: "replace", path: ["title"], value: "T" }],
      "p1" as PatchId,
      "2024-01-01T00:00:00.000Z",
      "author",
    );
    expect(() => indexPatchSets(patchSets.serialize(), [])).toThrow(
      /not in the chain order/,
    );
  });
});

describe("stageClosure", () => {
  test("staging a patch pulls in its predecessors within the same patch set", () => {
    expect(
      inChainOrder(
        arrayChain(),
        stageClosure(arrayChain(), ids(), ["p3" as PatchId]),
      ),
    ).toEqual(["p2", "p3"]);
  });

  test("staging does not pull in successors", () => {
    // The asymmetry the whole design rests on: p3 came after p2, so p2 can be
    // published without it.
    expect(
      inChainOrder(
        arrayChain(),
        stageClosure(arrayChain(), ids(), ["p2" as PatchId]),
      ),
    ).toEqual(["p2"]);
  });

  test("staging does not reach across patch sets", () => {
    expect(
      inChainOrder(
        arrayChain(),
        stageClosure(arrayChain(), ids(), ["p1" as PatchId]),
      ),
    ).toEqual(["p1"]);
  });

  test("is idempotent", () => {
    const i = arrayChain();
    const once = stageClosure(i, ids(), ["p3" as PatchId]);
    const twice = stageClosure(i, once, once);
    expect(Array.from(twice).sort()).toEqual(Array.from(once).sort());
  });

  test("reaches a fixpoint when one patch is in two patch sets", () => {
    // A `move` is inserted under both its destination and its source, so pulling it
    // in can extend the required prefix of a second set. A single pass would miss
    // that.
    const board = s.object({
      todo: s.array(s.object({ title: s.string() })),
      done: s.array(s.object({ title: s.string() })),
    });
    const patchSets = new PatchSets();
    const patches: { id: string; ops: Operation[] }[] = [
      {
        id: "q1",
        ops: [{ op: "replace", path: ["todo", "0", "title"], value: "T*" }],
      },
      {
        id: "q2",
        ops: [{ op: "replace", path: ["done", "0", "title"], value: "D*" }],
      },
      {
        id: "q3",
        ops: [{ op: "move", from: ["todo", "1"], path: ["done", "1"] }],
      },
    ];
    patches.forEach((patch, i) => {
      patchSets.insert(
        "/content/board.val.ts" as ModuleFilePath,
        board["executeSerialize"](),
        patch.ops,
        patch.id as PatchId,
        `2024-01-0${i + 1}T00:00:00.000Z`,
        "author",
      );
    });
    const i = indexPatchSets(
      patchSets.serialize(),
      patches.map((p) => p.id as PatchId),
    );
    expect(inChainOrder(i, stageClosure(i, ids(), ["q3" as PatchId]))).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
  });
});

describe("unstageClosure", () => {
  test("unstaging drops what was built on top of it", () => {
    const i = arrayChain();
    const all = ids("p1", "p2", "p3");
    expect(inChainOrder(i, unstageClosure(i, all, ["p2" as PatchId]))).toEqual([
      "p1",
    ]);
  });

  test("unstaging keeps what came before it", () => {
    const i = arrayChain();
    const all = ids("p1", "p2", "p3");
    expect(inChainOrder(i, unstageClosure(i, all, ["p3" as PatchId]))).toEqual([
      "p1",
      "p2",
    ]);
  });

  test("removing something that is not staged is a no-op", () => {
    const i = arrayChain();
    expect(
      inChainOrder(i, unstageClosure(i, ids("p1"), ["p3" as PatchId])),
    ).toEqual(["p1"]);
  });

  test("stage then unstage returns to the original group", () => {
    const i = arrayChain();
    const start = ids("p1");
    const staged = stageClosure(i, start, ["p3" as PatchId]);
    expect(
      inChainOrder(i, unstageClosure(i, staged, ["p2" as PatchId])),
    ).toEqual(["p1"]);
  });
});

describe("validateGroup", () => {
  test("a prefix is valid", () => {
    expect(validateGroup(arrayChain(), ids("p1", "p2"))).toEqual([]);
  });

  test("a hole is reported with the patch set and the missing ids", () => {
    expect(validateGroup(arrayChain(), ids("p1", "p3"))).toEqual([
      {
        patchSet: `${MODULE}?items`,
        staged: ["p3"],
        missing: ["p2"],
      },
    ]);
  });
});

describe("heldPatchSets and holdsRegionOf", () => {
  test("reports each patch set with something left out", () => {
    expect(heldPatchSets(arrayChain(), ids("p1", "p2"))).toEqual([
      { patchSet: `${MODULE}?items`, unstaged: ["p3"] },
    ]);
  });

  test("a fully staged group holds nothing", () => {
    expect(heldPatchSets(arrayChain(), ids("p1", "p2", "p3"))).toEqual([]);
  });

  test("holdsRegionOf is true only for patches whose region is held", () => {
    const i = arrayChain();
    const group = ids("p1");
    // `?items` has p2 and p3, neither staged, so both their regions are held.
    expect(holdsRegionOf(i, group, "p3" as PatchId)).toBe(true);
    // p1 is alone in `?title`, and it is staged, so nothing there is held.
    expect(holdsRegionOf(i, group, "p1" as PatchId)).toBe(false);
  });
});

describe("editWouldRestage", () => {
  test("an edit inside a held patch set is unsafe", () => {
    const i = arrayChain();
    expect(
      editWouldRestage(i, ids("p1", "p2"), MODULE, {
        op: "replace",
        path: ["items", "1", "title"],
      }),
    ).toEqual(["p3"]);
  });

  test("an edit in a different patch set is safe", () => {
    // The guard has to be narrow enough to be usable. If holding the array blocked
    // a title edit, unstaging would be pointless.
    const i = arrayChain();
    expect(
      editWouldRestage(i, ids("p1", "p2"), MODULE, {
        op: "replace",
        path: ["title"],
      }),
    ).toEqual([]);
  });

  test("a top-level replace is not widened to the whole module", () => {
    // Regression guard, and the reason the guard takes the op rather than just a
    // path. The parent of a top-level path is the module root, which contains every
    // patch set — so if a `replace` were widened to its parent, holding anything
    // anywhere would block every edit and unstaging would be useless.
    //
    // Here `?items` is held and `?title` is staged. A replace on `title` must be
    // safe; the same path as an `add` must not be, since `add` really does widen.
    const i = arrayChain();
    const holdingItems = ids("p1");
    expect(
      editWouldRestage(i, holdingItems, MODULE, {
        op: "replace",
        path: ["title"],
      }),
    ).toEqual([]);
    expect(
      editWouldRestage(i, holdingItems, MODULE, {
        op: "add",
        path: ["title"],
      }),
    ).toEqual(["p2", "p3"]);
  });

  test("everything is unsafe when nothing at all is staged", () => {
    // Not a special case — with an empty group every patch set is held, so there is
    // nowhere safe to edit. Worth pinning: it is what makes "a group holds
    // everything by default" load-bearing rather than a convenience.
    const i = arrayChain();
    expect(
      editWouldRestage(i, ids(), MODULE, { op: "replace", path: ["title"] }),
    ).toEqual(["p1"]);
  });

  test("an array op is widened to the parent, because that is the key it will use", () => {
    const i = arrayChain();
    expect(
      editWouldRestage(i, ids("p1", "p2"), MODULE, {
        op: "add",
        path: ["items", "1"],
      }),
    ).toEqual(["p3"]);
  });

  test("nothing is unsafe when nothing is held", () => {
    const i = arrayChain();
    expect(
      editWouldRestage(i, ids("p1", "p2", "p3"), MODULE, {
        op: "add",
        path: ["items", "1"],
      }),
    ).toEqual([]);
  });
});
