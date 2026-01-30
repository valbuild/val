import {
  initVal,
  Json,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
  SerializedSchema,
} from "@valbuild/core";
import { applyPatch, deepClone, JSONOps, Patch } from "@valbuild/core/patch";
import { comparePatchSets } from "./comparePatchSets";
import { PatchSets } from "./PatchSets";

type TestPatch = {
  patchId: string;
  patch: Patch;
  createdAt: string;
  author: string | null;
};

// Helper to apply patches and generate PatchSets
function applyPatchesAndGetSets(
  schema: Schema<SelectorSource>,
  beforeSource: Json,
  patches: TestPatch[],
  moduleFilePath: ModuleFilePath = "/test.val.ts" as ModuleFilePath,
): {
  patchSets: PatchSets;
  afterSource: Json;
  serializedSchema: SerializedSchema;
} {
  const patchSets = new PatchSets();
  const serializedSchema = schema["executeSerialize"]();
  let currentSource = beforeSource;
  const jsonOps = new JSONOps();

  for (const testPatch of patches) {
    for (const op of testPatch.patch) {
      patchSets.insert(
        moduleFilePath,
        serializedSchema,
        op,
        testPatch.patchId as PatchId,
        testPatch.createdAt,
        testPatch.author,
      );
    }
    const patchResult = applyPatch(
      deepClone(currentSource),
      jsonOps,
      testPatch.patch,
    );
    if (patchResult.kind === "ok") {
      currentSource = patchResult.value;
    } else {
      throw new Error(
        `Failed to apply patch: ${JSON.stringify(patchResult.error)} for patch ${JSON.stringify(testPatch.patch)}`,
      );
    }
  }

  return { patchSets, afterSource: currentSource, serializedSchema };
}

describe("comparePatchSets", () => {
  const { s } = initVal();
  describe("simple value changes", () => {
    it("detects simple string value change", () => {
      const schema = s.string();
      const beforeSource = "old";
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: [], value: "new" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result).toHaveLength(1);
      expect(result[0].before).toBe("old");
      expect(result[0].after).toBe("new");
      expect(result[0].beforeSchema?.type).toBe("string");
      expect(result[0].afterSchema?.type).toBe("string");
    });

    it("detects number value change", () => {
      const schema = s.number();
      const beforeSource = 42;
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: [], value: 100 }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe(42);
      expect(result[0].after).toBe(100);
      expect(result[0].beforeSchema?.type).toBe("number");
      expect(result[0].afterSchema?.type).toBe("number");
    });

    it("detects boolean value change", () => {
      const schema = s.boolean();
      const beforeSource = true;
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: [], value: false }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe(true);
      expect(result[0].after).toBe(false);
      expect(result[0].beforeSchema?.type).toBe("boolean");
      expect(result[0].afterSchema?.type).toBe("boolean");
    });
  });

  describe("nested object changes", () => {
    it("detects change in nested object property", () => {
      const schema = s.object({
        nested: s.number(),
      });
      const beforeSource: Json = { nested: 1 };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: ["nested"], value: 2 }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe(1);
      expect(result[0].after).toBe(2);
      expect(result[0].beforeSchema?.type).toBe("number");
      expect(result[0].afterSchema?.type).toBe("number");
    });

    it("detects deeply nested changes", () => {
      const schema = s.object({
        level1: s.object({
          level2: s.string(),
        }),
      });
      const beforeSource: Json = { level1: { level2: "before" } };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [
            { op: "replace", path: ["level1", "level2"], value: "after" },
          ],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe("before");
      expect(result[0].after).toBe("after");
      expect(result[0].beforeSchema?.type).toBe("string");
      expect(result[0].afterSchema?.type).toBe("string");
    });
  });

  describe("array changes", () => {
    it("detects array item change", () => {
      const schema = s.array(s.string());
      const beforeSource: Json = ["a", "b", "c"];
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: ["0"], value: "x" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe("a");
      expect(result[0].after).toBe("x");
      expect(result[0].beforeSchema?.type).toBe("string");
      expect(result[0].afterSchema?.type).toBe("string");
    });

    it("detects nested array item change", () => {
      const schema = s.array(
        s.object({
          name: s.string(),
        }),
      );
      const beforeSource: Json = [
        { name: "Alice" },
        { name: "Bob" },
        { name: "Charlie" },
      ];
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: ["1", "name"], value: "Bobby" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe("Bob");
      expect(result[0].after).toBe("Bobby");
      expect(result[0].beforeSchema?.type).toBe("string");
      expect(result[0].afterSchema?.type).toBe("string");
    });

    it("detects array item addition", () => {
      const schema = s.array(s.string());
      const beforeSource: Json = ["a", "b"];
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "add", path: ["-"], value: "c" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // PatchSets groups array adds at parent level
      expect(result[0].before).toEqual(["a", "b"]);
      expect(result[0].after).toEqual(["a", "b", "c"]);
      expect(result[0].beforeSchema?.type).toBe("array");
      expect(result[0].afterSchema?.type).toBe("array");
    });

    it("detects array item removal", () => {
      const schema = s.array(s.string());
      const beforeSource: Json = ["a", "b", "c"];
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "remove", path: ["1"] }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // PatchSets groups array removes at parent level
      expect(result[0].before).toEqual(["a", "b", "c"]);
      expect(result[0].after).toEqual(["a", "c"]);
      expect(result[0].beforeSchema?.type).toBe("array");
      expect(result[0].afterSchema?.type).toBe("array");
    });

    it("detects array item add then remove", () => {
      const schema = s.array(s.string());
      const beforeSource: Json = ["a", "b"];
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "add", path: ["-"], value: "c" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
        {
          patchId: "patch2",
          patch: [{ op: "remove", path: ["2"] }],
          createdAt: "2026-01-30T00:00:01Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // Both operations grouped at array level, newest first
      expect(result).toHaveLength(1);
      expect(result[0].before).toEqual(["a", "b"]);
      expect(result[0].after).toEqual(["a", "b"]);
      expect(result[0].beforeSchema?.type).toBe("array");
      expect(result[0].afterSchema?.type).toBe("array");
    });

    it("detects array add one item and remove another", () => {
      const schema = s.array(s.string());
      const beforeSource: Json = ["a", "b", "c"];
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "add", path: ["-"], value: "d" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
        {
          patchId: "patch2",
          patch: [{ op: "remove", path: ["1"] }],
          createdAt: "2026-01-30T00:00:01Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // Both operations grouped at array level
      expect(result).toHaveLength(1);
      expect(result[0].before).toEqual(["a", "b", "c"]);
      expect(result[0].after).toEqual(["a", "c", "d"]);
      expect(result[0].beforeSchema?.type).toBe("array");
      expect(result[0].afterSchema?.type).toBe("array");
    });
  });

  describe("record changes", () => {
    it("detects record value change", () => {
      const schema = s.record(s.number());
      const beforeSource: Json = { key1: 10, key2: 20 };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: ["key1"], value: 15 }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe(10);
      expect(result[0].after).toBe(15);
      expect(result[0].beforeSchema?.type).toBe("number");
      expect(result[0].afterSchema?.type).toBe("number");
    });

    it("detects record key addition", () => {
      const schema = s.record(s.number());
      const beforeSource: Json = { key1: 10 };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "add", path: ["key2"], value: 20 }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // Record add creates a patch set at the specific key level
      expect(result[0].before).toBe(null);
      expect(result[0].after).toBe(20);
      expect(result[0].beforeSchema).toBeUndefined();
      expect(result[0].afterSchema?.type).toBe("number");
    });

    it("detects record key removal", () => {
      const schema = s.record(s.number());
      const beforeSource: Json = { key1: 10, key2: 20 };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "remove", path: ["key2"] }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // Record remove creates a patch set at the specific key level
      expect(result[0].before).toBe(20);
      expect(result[0].after).toBe(null);
      expect(result[0].beforeSchema?.type).toBe("number");
      expect(result[0].afterSchema).toBeUndefined();
    });

    it("detects record key add then remove", () => {
      const schema = s.record(s.number());
      const beforeSource: Json = { key1: 10 };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "add", path: ["key2"], value: 20 }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
        {
          patchId: "patch2",
          patch: [{ op: "remove", path: ["key2"] }],
          createdAt: "2026-01-30T00:00:01Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // Both operations grouped at the same key level
      expect(result).toHaveLength(1);
      expect(result[0].before).toBe(null);
      expect(result[0].after).toBe(null);
      expect(result[0].beforeSchema).toBeUndefined();
      expect(result[0].afterSchema).toBeUndefined();
    });

    it("detects record add one key and remove another", () => {
      const schema = s.record(s.number());
      const beforeSource: Json = { key1: 10, key2: 20 };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "add", path: ["key3"], value: 30 }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
        {
          patchId: "patch2",
          patch: [{ op: "remove", path: ["key2"] }],
          createdAt: "2026-01-30T00:00:01Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // Two separate patch sets: one for key3 addition, one for key2 removal (newest first)
      expect(result).toHaveLength(2);
      expect(result[0].before).toBe(20);
      expect(result[0].after).toBe(null);
      expect(result[0].beforeSchema?.type).toBe("number");
      expect(result[0].afterSchema).toBeUndefined();
      expect(result[1].before).toBe(null);
      expect(result[1].after).toBe(30);
      expect(result[1].beforeSchema).toBeUndefined();
      expect(result[1].afterSchema?.type).toBe("number");
    });
  });

  describe("creation and deletion", () => {
    it("handles creation (before is undefined)", () => {
      const schema = s.object({
        newKey: s.boolean(),
      });
      const beforeSource: Json = {};
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "add", path: ["newKey"], value: true }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // PatchSets groups add/remove operations at the root level for objects
      expect(result[0].before).toEqual({});
      expect(result[0].after).toEqual({ newKey: true });
      expect(result[0].beforeSchema?.type).toBe("object");
      expect(result[0].afterSchema?.type).toBe("object");
    });

    it("handles deletion (after is undefined)", () => {
      const schema = s.object({
        key: s.boolean(),
      });
      const beforeSource: Json = { key: true };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "remove", path: ["key"] }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      // PatchSets groups add/remove operations at the root level for objects
      expect(result[0].before).toEqual({ key: true });
      expect(result[0].after).toEqual({});
      expect(result[0].beforeSchema?.type).toBe("object");
      expect(result[0].afterSchema?.type).toBe("object");
    });
  });

  describe("multiple patch sets", () => {
    it("handles multiple patch sets at once", () => {
      const schema = s.object({
        name: s.string(),
        age: s.number(),
        active: s.boolean(),
      });
      const beforeSource: Json = { name: "Alice", age: 30, active: false };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: ["name"], value: "Alicia" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
        {
          patchId: "patch2",
          patch: [{ op: "replace", path: ["age"], value: 31 }],
          createdAt: "2026-01-30T00:00:01Z",
          author: "user2",
        },
        {
          patchId: "patch3",
          patch: [{ op: "replace", path: ["active"], value: true }],
          createdAt: "2026-01-30T00:00:02Z",
          author: "user3",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result).toHaveLength(3);
      // PatchSets orders newest first
      expect(result[0].before).toBe(false);
      expect(result[0].after).toBe(true);
      expect(result[1].before).toBe(30);
      expect(result[1].after).toBe(31);
      expect(result[2].before).toBe("Alice");
      expect(result[2].after).toBe("Alicia");
    });
  });

  describe("discriminated union changes", () => {
    it("detects change within discriminated union variant", () => {
      const schema = s.union(
        "type",
        s.object({
          type: s.literal("text"),
          content: s.string(),
        }),
        s.object({
          type: s.literal("number"),
          value: s.number(),
        }),
      );
      const beforeSource: Json = { type: "text", content: "hello" };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: ["content"], value: "world" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe("hello");
      expect(result[0].after).toBe("world");
      expect(result[0].beforeSchema?.type).toBe("string");
      expect(result[0].afterSchema?.type).toBe("string");
    });

    it("detects change between discriminated union variants", () => {
      const schema = s.union(
        "type",
        s.object({
          type: s.literal("text"),
          content: s.string(),
        }),
        s.object({
          type: s.literal("number"),
          value: s.number(),
        }),
      );
      const beforeSource: Json = { type: "text", content: "hello" };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [
            { op: "replace", path: [], value: { type: "number", value: 42 } },
          ],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toEqual({ type: "text", content: "hello" });
      expect(result[0].after).toEqual({ type: "number", value: 42 });
      expect(result[0].beforeSchema?.type).toBe("union");
      expect(result[0].afterSchema?.type).toBe("union");
    });

    it("detects change in discriminator field with different kinds", () => {
      const schema = s.union(
        "kind",
        s.object({
          kind: s.literal("section"),
          title: s.string(),
        }),
        s.object({
          kind: s.literal("divider"),
          style: s.string(),
        }),
        s.object({
          kind: s.literal("spacer"),
          height: s.number(),
        }),
      );
      const beforeSource: Json = { kind: "section", title: "My Title" };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [
            {
              op: "replace",
              path: [],
              value: { kind: "divider", style: "solid" },
            },
          ],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toEqual({ kind: "section", title: "My Title" });
      expect(result[0].after).toEqual({ kind: "divider", style: "solid" });
      expect(result[0].beforeSchema?.type).toBe("union");
      expect(result[0].afterSchema?.type).toBe("union");
    });

    it("detects nested discriminated union within array", () => {
      const schema = s.array(
        s.union(
          "type",
          s.object({
            type: s.literal("text"),
            content: s.string(),
          }),
          s.object({
            type: s.literal("number"),
            value: s.number(),
          }),
        ),
      );
      const beforeSource: Json = [
        { type: "text", content: "first" },
        { type: "number", value: 10 },
      ];
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: ["1", "value"], value: 20 }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe(10);
      expect(result[0].after).toBe(20);
      expect(result[0].beforeSchema?.type).toBe("number");
      expect(result[0].afterSchema?.type).toBe("number");
    });

    it("detects change in deeply nested discriminated union", () => {
      const schema = s.object({
        items: s.array(
          s.union(
            "kind",
            s.object({
              kind: s.literal("section"),
              title: s.string(),
              blocks: s.array(
                s.union(
                  "type",
                  s.object({
                    type: s.literal("paragraph"),
                    text: s.string(),
                  }),
                  s.object({
                    type: s.literal("image"),
                    url: s.string(),
                  }),
                ),
              ),
            }),
            s.object({
              kind: s.literal("divider"),
              style: s.string(),
            }),
          ),
        ),
      });
      const beforeSource: Json = {
        items: [
          {
            kind: "section",
            title: "My Section",
            blocks: [
              { type: "paragraph", text: "Hello" },
              { type: "image", url: "/old.png" },
            ],
          },
        ],
      };
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [
            {
              op: "replace",
              path: ["items", "0", "blocks", "1", "url"],
              value: "/new.png",
            },
          ],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe("/old.png");
      expect(result[0].after).toBe("/new.png");
      expect(result[0].beforeSchema?.type).toBe("string");
      expect(result[0].afterSchema?.type).toBe("string");
    });
  });

  describe("edge cases", () => {
    it("handles empty patch path (root level)", () => {
      const schema = s.string();
      const beforeSource: Json = "before";
      const patches: TestPatch[] = [
        {
          patchId: "patch1",
          patch: [{ op: "replace", path: [], value: "after" }],
          createdAt: "2026-01-30T00:00:00Z",
          author: "user1",
        },
      ];

      const { patchSets, afterSource, serializedSchema } =
        applyPatchesAndGetSets(schema, beforeSource, patches);

      const result = comparePatchSets(
        serializedSchema,
        patchSets.serialize(),
        beforeSource,
        afterSource,
      );

      expect(result[0].before).toBe("before");
      expect(result[0].after).toBe("after");
      expect(result[0].beforeSchema?.type).toBe("string");
      expect(result[0].afterSchema?.type).toBe("string");
    });
  });
});
