import { initVal, type PatchId } from "@valbuild/core";
import type { Patch, ReadonlyJSONValue } from "@valbuild/core/patch";
import {
  applyChain,
  applyPatchRecord,
  baseModuleContent,
  engineWork,
  entryState,
  resolveEntry,
  type ModuleContent,
} from "./applyChain";

const { s } = initVal();

const record = (patch: Patch, n = 1) => ({
  patchId: `p${n}` as PatchId,
  patch,
});

/** What is at a path, by reference: no copy on the way. */
function at(doc: ReadonlyJSONValue, ...path: string[]): unknown {
  let node: unknown = doc;
  for (const key of path) {
    node =
      typeof node === "object" && node !== null
        ? Object.getOwnPropertyDescriptor(node, key)?.value
        : undefined;
  }
  return node;
}

function applied(res: ReturnType<typeof applyPatchRecord>): ModuleContent {
  if (res.status !== "applied") throw new Error(res.message);
  return res.module;
}

describe("applyPatchRecord: copy-on-write", () => {
  const schema = s
    .object({
      title: s.string(),
      items: s.array(s.object({ name: s.string() })),
      other: s.object({ deep: s.object({ n: s.number() }) }),
    })
    ["executeSerialize"]();
  const base = () => ({
    title: "T",
    items: [{ name: "a" }, { name: "b" }, { name: "c" }],
    other: { deep: { n: 1 } },
  });

  test("copies only along the op's path: everything else keeps its identity", () => {
    const source = base();
    const frozen = JSON.stringify(source);
    const next = applied(
      applyPatchRecord(
        baseModuleContent(source),
        record([{ op: "replace", path: ["items", "1", "name"], value: "B" }]),
        schema,
      ),
    ).source;
    expect(next).toEqual({
      ...base(),
      items: [{ name: "a" }, { name: "B" }, { name: "c" }],
    });
    expect(JSON.stringify(source)).toBe(frozen); // nothing mutated
    expect(next).not.toBe(source);
    expect(at(next, "items")).not.toBe(source.items);
    expect(at(next, "items", "1")).not.toBe(source.items[1]);
    expect(at(next, "items", "0")).toBe(source.items[0]);
    expect(at(next, "items", "2")).toBe(source.items[2]);
    expect(at(next, "other")).toBe(source.other);
  });

  test("counts what it copies: the containers on the path, and a patch", () => {
    const before = engineWork();
    applyPatchRecord(
      baseModuleContent(base()),
      record([{ op: "replace", path: ["other", "deep", "n"], value: 2 }]),
      schema,
    );
    const after = engineWork();
    expect(after.applyPatch - before.applyPatch).toBe(1);
    // root (3 slots) + other (1) + deep (1), 8 bytes a slot
    expect(after.cloneBytes - before.cloneBytes).toBe(8 * 5);
  });

  test("a failing patch changes nothing, and says which patch", () => {
    const module = baseModuleContent(base());
    const res = applyPatchRecord(
      module,
      record(
        [
          { op: "replace", path: ["title"], value: "half" },
          { op: "replace", path: ["nope"], value: 1 },
        ],
        7,
      ),
      schema,
    );
    expect(res).toEqual({
      status: "failed",
      patchId: "p7",
      message: "Cannot replace object element which does not exist",
    });
  });

  test("a chain stops at its first failure and says how far it got", () => {
    const res = applyChain(
      baseModuleContent(base()),
      [
        record([{ op: "replace", path: ["title"], value: "one" }], 1),
        record([{ op: "remove", path: ["nope"] }], 2),
        record([{ op: "replace", path: ["title"], value: "three" }], 3),
      ],
      schema,
    );
    expect(res.applied).toBe(1);
    expect(res.failed?.patchId).toBe("p2");
    expect(res.module.source).toMatchObject({ title: "one" });
  });
});

describe("applyPatchRecord: .jsonValues() entries", () => {
  const schema = s
    .record(s.object({ title: s.string(), order: s.number() }))
    .jsonValues()
    ["executeSerialize"]();
  const marker = { _type: "json" };
  const bases: Record<string, { title: string; order: number }> = {
    "/a": { title: "A", order: 1 },
    "/b": { title: "B", order: 2 },
  };
  const baseOf = (key: string) => bases[key];

  test("an edit to an entry nobody loaded is held, and applied when it is read", () => {
    const source = { "/a": marker, "/b": marker };
    const res = applyChain(
      baseModuleContent(source),
      [
        record([{ op: "replace", path: ["/a", "title"], value: "A1" }], 1),
        record([{ op: "replace", path: ["/a", "order"], value: 5 }], 2),
      ],
      schema,
    );
    expect(res.module.source).toBe(source); // the markers did not move
    expect(entryState(res.module, "/a")).toMatchObject({
      kind: "waiting",
      from: "/a",
    });
    expect(resolveEntry("/a", entryState(res.module, "/a"), baseOf)).toEqual({
      kind: "content",
      content: { title: "A1", order: 5 },
    });
    expect(resolveEntry("/b", entryState(res.module, "/b"), baseOf)).toEqual({
      kind: "content",
      content: { title: "B", order: 2 },
    });
  });

  test("a renamed entry reads its content from where it came from", () => {
    const res = applyChain(
      baseModuleContent({ "/a": marker, "/b": marker }),
      [record([{ op: "move", from: ["/a"], path: ["/c"] }], 1)],
      schema,
    );
    expect(res.module.source).toEqual({
      "/b": marker,
      "/c": { _type: "json", patch_id: "p1" },
    });
    expect(resolveEntry("/c", entryState(res.module, "/c"), baseOf)).toEqual({
      kind: "content",
      content: bases["/a"],
    });
    expect(resolveEntry("/a", entryState(res.module, "/a"), baseOf)).toEqual({
      kind: "missing",
    });
  });

  test("an added entry's content is in the entry, its marker in the source", () => {
    const res = applyChain(
      baseModuleContent({ "/a": marker }),
      [
        record(
          [{ op: "add", path: ["/new"], value: { title: "N", order: 3 } }],
          1,
        ),
      ],
      schema,
    );
    expect(res.module.source).toEqual({
      "/a": marker,
      "/new": { _type: "json", patch_id: "p1" },
    });
    expect(entryState(res.module, "/new")).toEqual({
      kind: "content",
      content: { title: "N", order: 3 },
    });
  });
});

describe("applyPatchRecord: an own `__proto__` key", () => {
  /**
   * JSON can name a key `__proto__`, and `JSON.parse` makes it an own data
   * property. Copying the object along a patch's path must keep it one: an
   * assignment would call the prototype setter instead, losing the key and
   * changing what the copy inherits.
   */
  test("is copied as an own key, and the copy's prototype is untouched", () => {
    const source: ReadonlyJSONValue = JSON.parse(
      '{"__proto__": {"polluted": true}, "title": "Hello"}',
    );
    const module = applied(
      applyPatchRecord(
        baseModuleContent(source),
        record([{ op: "replace", path: ["title"], value: "Typed" }]),
        undefined,
      ),
    );
    const copied = module.source;
    if (typeof copied !== "object" || copied === null) {
      throw new Error("not an object");
    }
    expect(at(copied, "title")).toBe("Typed");
    expect(at(copied, "__proto__")).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
    expect(Object.keys(copied)).toEqual(["__proto__", "title"]);
  });
});
