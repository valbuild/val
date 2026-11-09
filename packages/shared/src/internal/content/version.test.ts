import type { ModuleFilePath, PatchId } from "@valbuild/core";
import {
  ChainFold,
  EMPTY_CHAIN,
  baseVersionOf,
  chainOf,
  extendChain,
  moduleKey,
  schemaVersionOf,
  versionHashCount,
} from "./version";

const a = "/content/a.val.ts" as ModuleFilePath;
const b = "/content/b.val.ts" as ModuleFilePath;
const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}` as PatchId;

describe("versions", () => {
  test("a chain is a fold of its ids, in order", () => {
    expect(chainOf([])).toBe(EMPTY_CHAIN);
    expect(chainOf([id(1), id(2)])).toBe(
      extendChain(extendChain(EMPTY_CHAIN, id(1)), id(2)),
    );
    expect(chainOf([id(1), id(2)])).not.toBe(chainOf([id(2), id(1)]));
  });

  test("schema and base versions depend on what they hash, and only that", () => {
    expect(schemaVersionOf({ type: "string" })).toBe(
      schemaVersionOf({ type: "string" }),
    );
    expect(schemaVersionOf({ type: "string" })).not.toBe(
      schemaVersionOf({ type: "number" }),
    );
    expect(baseVersionOf({ title: "Hello" })).not.toBe(
      baseVersionOf({ title: "Hello world" }),
    );
  });

  test("a module key names the path and all three parts", () => {
    const key = moduleKey(a, { schema: "s", base: "b", chain: "c" });
    expect(key).toBe("/content/a.val.ts@s.b.c");
  });
});

describe("ChainFold", () => {
  test("each module's chain is the fold of its own patches", () => {
    const fold = new ChainFold();
    const chains = fold.chainsOf([
      { patchId: id(1), path: a },
      { patchId: id(2), path: b },
      { patchId: id(3), path: a },
    ]);
    expect(chains.get(a)).toBe(chainOf([id(1), id(3)]));
    expect(chains.get(b)).toBe(chainOf([id(2)]));
  });

  test("an unchanged chain hashes nothing; a longer one hashes only what it gained", () => {
    const fold = new ChainFold();
    const first = [
      { patchId: id(1), path: a },
      { patchId: id(2), path: b },
    ];
    fold.chainsOf(first);
    const epoch = fold.epoch();

    const before = versionHashCount();
    fold.chainsOf([...first]);
    expect(versionHashCount() - before).toBe(0);
    expect(fold.epoch()).toBe(epoch);

    const grown = versionHashCount();
    const chains = fold.chainsOf([...first, { patchId: id(3), path: a }]);
    expect(versionHashCount() - grown).toBe(1);
    expect(chains.get(a)).toBe(chainOf([id(1), id(3)]));
    expect(fold.epoch()).not.toBe(epoch);
  });

  test("two folds never name one epoch, even at the same count", () => {
    // Two isolates over one patch store: each folds what it has read. The
    // same count of moves must not read as the same chains (an ETag 304).
    const one = new ChainFold();
    const two = new ChainFold();
    one.chainsOf([{ patchId: id(1), path: a }]);
    two.chainsOf([{ patchId: id(2), path: a }]);
    expect(one.epoch()).not.toBe(two.epoch());
  });

  test("a discard in the middle is folded again from the start", () => {
    const fold = new ChainFold();
    fold.chainsOf([
      { patchId: id(1), path: a },
      { patchId: id(2), path: a },
    ]);
    const chains = fold.chainsOf([{ patchId: id(2), path: a }]);
    expect(chains.get(a)).toBe(chainOf([id(2)]));
    // And back to nothing: a module with no patches has no chain here.
    expect(fold.chainsOf([]).get(a)).toBeUndefined();
  });
});

describe("ChainFold.chainAt", () => {
  test("names the chain after a module's first n patches, without hashing", () => {
    const fold = new ChainFold();
    const chains = fold.chainsOf([
      { patchId: id(1), path: a },
      { patchId: id(2), path: b },
      { patchId: id(3), path: a },
    ]);
    const afterOne = chainOf([id(1)]);
    const before = versionHashCount();
    expect(fold.chainAt(a, 0)).toBe(EMPTY_CHAIN);
    expect(fold.chainAt(a, 1)).toBe(afterOne);
    expect(fold.chainAt(a, 2)).toBe(chains.get(a));
    expect(fold.chainAt(b, 1)).toBe(chains.get(b));
    expect(versionHashCount()).toBe(before);
  });
});
