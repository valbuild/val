import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import type {
  FileOperation,
  JSONValue,
  Operation,
  Patch,
} from "@valbuild/core/patch";
import {
  applyPatchRecord,
  baseModuleContent,
  entryState,
  resolveEntry,
  type ModuleContent,
} from "@valbuild/shared/internal";
import {
  legacyApplyJsonValuesEntryPatches,
  legacyGetSources,
} from "./legacyEngine";

/**
 * The engine's conformance cases: a table of (schema, source, entries,
 * patches) and what comes out, run against the OLD engine (`legacyEngine.ts`,
 * test-only: `ValOps.getSources`'s patch loop and
 * `applyJsonValuesEntryPatches`, as they were) and the NEW one
 * (`applyPatchRecord`, in `@valbuild/shared`).
 *
 * A case without `differs` must come out the same from both. A case with it
 * is a difference that was found, and decided: `legacy` is what the old
 * engine answers, held so a change to either side is noticed, and `why` says
 * why the new answer is the right one. Every `differs` is listed in the plan
 * (`docs/plans/one-content-model.md`, phase 2's findings).
 */

const { s } = initVal();
const MODULE = "/content/module.val.ts" as ModuleFilePath;

type EntryOutcome = { content: unknown } | "missing" | { error: string };
type Outcome = {
  /** The module's source after the chain (as far as it applied). */
  source: unknown;
  /** The first patch that failed, by index, and why. */
  failed: { patch: number; message: string } | null;
  /** The patches not tried because an earlier one failed. */
  skipped: number[];
  /** Each `.jsonValues()` entry read, by key. */
  entries: Record<string, EntryOutcome>;
  /** Whether applying left the patches themselves as they were. */
  patchesUnchanged: boolean;
};

type Case = {
  name: string;
  schema?: SerializedSchema;
  source: JSONValue;
  /** The base content of each `.jsonValues()` entry, by key. */
  entries?: Record<string, JSONValue>;
  patches: Patch[];
  /** Entry keys to read; by default every base key and every key a patch names. */
  read?: string[];
  differs?: {
    why: string;
    /**
     * What the old engine answers, or `"mutates-the-patch"`: the same
     * outcome, except that applying changed the patch itself.
     */
    legacy: Outcome | "mutates-the-patch";
  };
};

const ids = (patches: Patch[]) =>
  patches.map((patch, i) => ({
    path: MODULE,
    patchId: `p${i + 1}` as PatchId,
    patch,
  }));

function keysToRead(c: Case): string[] {
  if (c.read) return c.read;
  const keys = new Set(Object.keys(c.entries ?? {}));
  if (c.schema?.type === "record" && c.schema.jsonValues) {
    for (const patch of c.patches) {
      for (const op of patch) {
        if (typeof op.path[0] === "string") keys.add(op.path[0]);
        if ("from" in op && typeof op.from[0] === "string")
          keys.add(op.from[0]);
        if (op.path.length === 0 && (op.op === "add" || op.op === "replace")) {
          const value = op.value;
          if (value && typeof value === "object" && !Array.isArray(value)) {
            for (const key of Object.keys(value)) keys.add(key);
          }
        }
      }
    }
  }
  return [...keys].sort();
}

function isMarker(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { _type?: unknown })._type === "json"
  );
}

/** What the base has for an entry: its content behind a marker, or nothing. */
function baseEntry(c: Case, key: string): JSONValue | undefined {
  const source = c.source;
  if (
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source) ||
    !isMarker(source[key])
  ) {
    return undefined;
  }
  return c.entries?.[key] ?? null;
}

function runLegacy(c: Case): Outcome {
  const records = ids(c.patches);
  const before = JSON.stringify(c.patches);
  const sources: Record<ModuleFilePath, Source> = { [MODULE]: c.source };
  const res = legacyGetSources(sources, () => c.schema, { patches: records });
  const errors = res.errors[MODULE] ?? [];
  const failure = errors.find((e) => !e.skipped);
  const entries: Record<string, EntryOutcome> = {};
  if (c.schema?.type === "record" && c.schema.jsonValues) {
    for (const key of keysToRead(c)) {
      const r = legacyApplyJsonValuesEntryPatches({
        serializedSchema: c.schema,
        entryKey: key,
        baseContent: baseEntry(c, key),
        patches: records,
        baseContentOf: (k) => ({ content: baseEntry(c, k) }),
      });
      entries[key] =
        r.kind === "content"
          ? { content: r.content }
          : r.kind === "deleted"
            ? "missing"
            : { error: r.message };
    }
  }
  return {
    source: MODULE in res.sources ? res.sources[MODULE] : c.source,
    failed: failure
      ? {
          patch: records.findIndex((r) => r.patchId === failure.patchId),
          message: failure.error.message,
        }
      : null,
    skipped: errors
      .filter((e) => e.skipped)
      .map((e) => records.findIndex((r) => r.patchId === e.patchId)),
    entries,
    patchesUnchanged: JSON.stringify(c.patches) === before,
  };
}

/** The way `ValOps.getSources` drives the engine: stop at the first failure. */
function runNew(c: Case): Outcome {
  const records = ids(c.patches);
  const before = JSON.stringify(c.patches);
  let module: ModuleContent = baseModuleContent(c.source);
  let failed: Outcome["failed"] = null;
  const skipped: number[] = [];
  for (const [i, record] of records.entries()) {
    if (failed !== null) {
      skipped.push(i);
      continue;
    }
    const res = applyPatchRecord(module, record, c.schema);
    if (res.status === "failed") {
      failed = { patch: i, message: res.message };
    } else {
      module = res.module;
    }
  }
  const entries: Record<string, EntryOutcome> = {};
  if (c.schema?.type === "record" && c.schema.jsonValues) {
    for (const key of keysToRead(c)) {
      const r = resolveEntry(key, entryState(module, key), (k) =>
        baseEntry(c, k),
      );
      entries[key] =
        r.kind === "content"
          ? { content: r.content }
          : r.kind === "missing"
            ? "missing"
            : { error: r.message };
    }
  }
  return {
    source: module.source,
    failed,
    skipped,
    entries,
    patchesUnchanged: JSON.stringify(c.patches) === before,
  };
}

// #region the cases

const page = s
  .object({
    title: s.string(),
    tags: s.array(s.string()),
    hero: s.image().nullable(),
  })
  ["executeSerialize"]();
const pageSource: JSONValue = {
  title: "Hello",
  tags: ["a", "b", "c"],
  hero: null,
  nested: { deep: { value: 1 } },
};

const entriesSchema = s
  .record(s.object({ title: s.string(), order: s.number() }))
  .jsonValues()
  ["executeSerialize"]();
const marker = { _type: "json" };
const recordSource: JSONValue = { "/a": marker, "/b": marker };
const recordEntries: Record<string, JSONValue> = {
  "/a": { title: "A", order: 1 },
  "/b": { title: "B", order: 2 },
};
const mediaSchema = s
  .record(s.object({ hero: s.image().nullable() }))
  .jsonValues()
  ["executeSerialize"]();
const imageSchema = s.record(s.image()).jsonValues()["executeSerialize"]();
const nullableRecordSchema = s
  .record(s.object({ title: s.string(), order: s.number() }))
  .jsonValues()
  .nullable()
  ["executeSerialize"]();

const upload = (path: string[], nestedFilePath?: string[]): FileOperation => ({
  op: "file",
  path,
  filePath: "/public/val/hero_a1b2c.png",
  value: "data:image/png;base64,AAAA",
  remote: false,
  ...(nestedFilePath ? { nestedFilePath } : {}),
});
const image = { path: "/public/val/hero_a1b2c.png", width: 8, height: 8 };

const cases: Case[] = [
  // --- plain JSON, as `JSONOps` applies it
  {
    name: "replace a field",
    schema: page,
    source: pageSource,
    patches: [[{ op: "replace", path: ["title"], value: "Hi" }]],
  },
  {
    name: "add a new key, and add over an existing one",
    schema: page,
    source: pageSource,
    patches: [
      [{ op: "add", path: ["extra"], value: 1 }],
      [{ op: "add", path: ["title"], value: "Over" }],
    ],
  },
  {
    name: "array add at an index, at '-', and out of bounds",
    schema: page,
    source: pageSource,
    patches: [
      [{ op: "add", path: ["tags", "1"], value: "x" }],
      [{ op: "add", path: ["tags", "-"], value: "z" }],
      [{ op: "add", path: ["tags", "9"], value: "!" }],
      [{ op: "replace", path: ["title"], value: "never" }],
    ],
  },
  {
    name: "an invalid array index",
    schema: page,
    source: pageSource,
    patches: [[{ op: "replace", path: ["tags", "01"], value: "x" }]],
  },
  {
    name: "remove from an array and an object, then a key that is not there",
    schema: page,
    source: pageSource,
    patches: [
      [{ op: "remove", path: ["tags", "0"] }],
      [{ op: "remove", path: ["nested", "deep"] }],
      [{ op: "remove", path: ["nope"] }],
    ],
  },
  {
    name: "replace a key that is not there",
    schema: page,
    source: pageSource,
    patches: [[{ op: "replace", path: ["nope"], value: 1 }]],
  },
  {
    name: "a path through a primitive, and through a missing key",
    schema: page,
    source: pageSource,
    patches: [
      [{ op: "replace", path: ["title", "x"], value: 1 }],
      [{ op: "replace", path: ["missing", "x"], value: 1 }],
    ],
  },
  {
    name: "move within an array and between objects",
    schema: page,
    source: pageSource,
    patches: [
      [{ op: "move", from: ["tags", "0"], path: ["tags", "2"] }],
      [{ op: "move", from: ["nested", "deep"], path: ["moved"] }],
      [{ op: "move", from: ["nope"], path: ["x"] }],
    ],
  },
  {
    name: "copy, then edit the copy: the original stays",
    schema: page,
    source: pageSource,
    patches: [
      [{ op: "copy", from: ["nested"], path: ["copied"] }],
      [{ op: "replace", path: ["copied", "deep", "value"], value: 2 }],
    ],
  },
  {
    name: "replace and add the root",
    source: { a: 1 },
    patches: [
      [{ op: "replace", path: [], value: { b: 2 } }],
      [{ op: "add", path: [], value: [1, 2] }],
      [{ op: "add", path: ["-"], value: 3 }],
    ],
  },
  {
    name: "a module whose content became null",
    schema: s.string().nullable()["executeSerialize"](),
    source: "text",
    patches: [
      [{ op: "replace", path: [], value: null }],
      [{ op: "test", path: [], value: null }],
    ],
    differs: {
      why: 'The old loop asked `if (!patchedSources[path])` to find a module\'s first patch, so a module whose content had become null, "", 0 or false was put back to its base before its next patch: a nullable module set to null came back as soon as anything else touched it. Here the next patch tests for the null, so the old engine fails it: it is testing "text".',
      legacy: {
        source: "text",
        failed: { patch: 1, message: "Test failed" },
        skipped: [],
        entries: {},
        patchesUnchanged: true,
      },
    },
  },
  {
    name: "a test op that matches, deeply, lets the patch through",
    schema: page,
    source: pageSource,
    patches: [
      [
        { op: "test", path: ["title"], value: "Hello" },
        { op: "test", path: ["tags"], value: ["a", "b", "c"] },
        { op: "test", path: ["nested"], value: { deep: { value: 1 } } },
        { op: "replace", path: ["title"], value: "after the test" },
      ],
    ],
  },
  {
    name: "a test op whose value differs fails the patch",
    schema: page,
    source: pageSource,
    patches: [
      [
        { op: "test", path: ["title"], value: "not the title" },
        { op: "replace", path: ["title"], value: "after the test" },
      ],
      [{ op: "replace", path: ["title"], value: "skipped" }],
    ],
  },
  {
    name: "a test op on a path that does not exist fails the patch",
    schema: page,
    source: pageSource,
    patches: [
      [
        { op: "test", path: ["no", "such", "path"], value: 1 },
        { op: "replace", path: ["title"], value: "after the test" },
      ],
    ],
  },
  {
    name: "a later op in a patch edits inside a value an earlier op added",
    schema: page,
    source: pageSource,
    patches: [
      [
        { op: "add", path: ["added"], value: { inner: { n: 1 } } },
        { op: "replace", path: ["added", "inner", "n"], value: 2 },
      ],
    ],
    differs: {
      why: "The old engine inserted the op's value by reference and then mutated it, so applying a patch changed the patch: a stored patch (memory mode) and what GET /patches sends then said n: 2 for the add. Nothing is mutated now.",
      legacy: "mutates-the-patch",
    },
  },

  // --- files: where the `patch_id` lands
  {
    name: "an upload: the value, then the file op",
    schema: page,
    source: pageSource,
    patches: [
      [{ op: "replace", path: ["hero"], value: image }, upload(["hero"])],
    ],
    differs: {
      why: "The old engine wrote the patch_id into the value the patch's own replace op carries (inserted by reference, then marked), so every upload changed its patch: in memory mode the stored patch, and what GET /patches then sent the Studio, carried a patch_id the editor never wrote.",
      legacy: "mutates-the-patch",
    },
  },
  {
    name: "a file op before the value it marks: the mark comes after every op",
    schema: page,
    source: pageSource,
    patches: [
      [upload(["hero"]), { op: "replace", path: ["hero"], value: image }],
    ],
    differs: {
      why: "The old engine wrote the patch_id into the value the patch's own replace op carries (inserted by reference, then marked), so every upload changed its patch: in memory mode the stored patch, and what GET /patches then sent the Studio, carried a patch_id the editor never wrote.",
      legacy: "mutates-the-patch",
    },
  },
  {
    name: "a video's poster and captions: each at its nestedFilePath",
    source: {
      video: { poster: { path: "/p.png" }, captions: [{ path: "/c.vtt" }] },
    },
    patches: [
      [upload(["video"], ["poster"]), upload(["video"], ["captions", "0"])],
    ],
  },
  {
    name: "a deleted file: no patch_id",
    schema: page,
    source: { ...pageSource, hero: image },
    patches: [
      [
        { op: "replace", path: ["hero"], value: null },
        { ...upload(["hero"]), value: null },
      ],
    ],
  },
  {
    name: "a file op where nothing is",
    schema: page,
    source: pageSource,
    patches: [[upload(["nope"])]],
  },

  // --- .jsonValues() entries
  {
    name: "an edit inside an entry: the entry, not the marker",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [{ op: "replace", path: ["/a", "title"], value: "A!" }],
      [{ op: "replace", path: ["/b", "order"], value: 9 }],
    ],
  },
  {
    name: "a whole entry added, replaced and removed",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [{ op: "add", path: ["/new"], value: { title: "N", order: 3 } }],
      [{ op: "replace", path: ["/a"], value: { title: "A2", order: 1 } }],
      [{ op: "remove", path: ["/b"] }],
      [{ op: "replace", path: ["/new", "title"], value: "N!" }],
    ],
  },
  {
    name: "an entry renamed (move), then renamed again",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [{ op: "replace", path: ["/a", "title"], value: "A, edited" }],
      [{ op: "move", from: ["/a"], path: ["/renamed"] }],
      [{ op: "move", from: ["/renamed"], path: ["/again"] }],
      [{ op: "replace", path: ["/again", "order"], value: 7 }],
    ],
  },
  {
    name: "an entry copied: earlier edits come along, later ones do not",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [{ op: "replace", path: ["/a", "title"], value: "A, edited" }],
      [{ op: "copy", from: ["/a"], path: ["/copy"] }],
      [{ op: "replace", path: ["/a", "order"], value: 9 }],
      [{ op: "replace", path: ["/copy", "order"], value: 2 }],
    ],
  },
  {
    name: "an edit to an entry that does not exist",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [[{ op: "replace", path: ["/nope", "title"], value: "x" }]],
  },
  {
    name: "a write of the whole record",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [
        {
          op: "replace",
          path: [],
          value: {
            "/a": { title: "A!", order: 1 },
            "/c": { title: "C", order: 3 },
          },
        },
      ],
    ],
  },
  {
    name: "a write of the whole record that leaves an entry as it is",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [
        {
          op: "replace",
          path: [],
          value: recordEntries,
        },
      ],
    ],
  },
  {
    name: "media uploaded into an entry",
    schema: mediaSchema,
    source: recordSource,
    entries: { "/a": { hero: null }, "/b": { hero: null } },
    patches: [
      [
        { op: "replace", path: ["/a", "hero"], value: image },
        upload(["/a", "hero"]),
      ],
    ],
  },
  {
    name: "a file deleted inside an entry",
    schema: mediaSchema,
    source: recordSource,
    entries: { "/a": { hero: image }, "/b": { hero: null } },
    patches: [
      [
        { op: "replace", path: ["/a", "hero"], value: null },
        { ...upload(["/a", "hero"]), value: null },
      ],
    ],
  },
  {
    name: "rich text inline media in an entry: marked at its nestedFilePath",
    schema: s
      .record(s.object({ body: s.richtext({ img: true }) }))
      .jsonValues()
      ["executeSerialize"](),
    source: { "/a": marker },
    entries: {
      "/a": {
        body: [
          {
            tag: "p",
            children: [{ tag: "img", src: { path: "/public/val/i.png" } }],
          },
        ],
      },
    },
    patches: [[upload(["/a", "body", "0", "children", "0"], ["src"])]],
  },
  {
    name: "an entry that IS the media: the marker and the content are marked",
    schema: imageSchema,
    source: { "/a": marker },
    entries: { "/a": image },
    patches: [[{ op: "replace", path: ["/a"], value: image }, upload(["/a"])]],
  },
  {
    name: "without a schema nothing is an entry op",
    source: recordSource,
    entries: recordEntries,
    patches: [[{ op: "replace", path: ["/a", "title"], value: "A!" }]],
  },

  // --- .jsonValues(): where the two engines disagreed
  {
    name: "a file op inside an entry, before the value it marks",
    schema: mediaSchema,
    source: recordSource,
    entries: { "/a": { hero: null }, "/b": { hero: null } },
    patches: [
      [
        upload(["/a", "hero"]),
        { op: "replace", path: ["/a", "hero"], value: image },
      ],
    ],
    differs: {
      why: "The module marked a file after every op of its patch, an entry in op order, so an upload inside an entry whose file op came first was marked on the value BEFORE it (here null: an error for the whole entry), while the same patch on a module field was fine. One rule now: after every op, in the module and in an entry alike.",
      legacy: {
        source: recordSource,
        failed: null,
        skipped: [],
        entries: {
          "/a": { error: "Cannot add to non-object/array" },
          "/b": { content: { hero: null } },
        },
        patchesUnchanged: true,
      },
    },
  },
  {
    name: "an entry edit after the module's chain stopped",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [{ op: "remove", path: ["/nope"] }],
      [{ op: "replace", path: ["/a", "title"], value: "A, after" }],
    ],
    differs: {
      why: "A module's chain stops at its first failing patch. The old entry replay ignored that and applied the later patches to an entry anyway, so an entry was read at a chain its module was not at (and its version could not say which). Entries stop with their module now.",
      legacy: {
        source: recordSource,
        failed: {
          patch: 0,
          message: "Cannot remove from non-object/array",
        },
        skipped: [1],
        entries: {
          "/a": { content: { title: "A, after", order: 1 } },
          "/b": { content: { title: "B", order: 2 } },
          "/nope": "missing",
        },
        patchesUnchanged: true,
      },
    },
  },
  {
    name: "a whole record written with markers",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [
      [
        {
          op: "replace",
          path: [],
          value: { "/a": { _type: "json", patch_id: "p0" } },
        },
      ],
    ],
    differs: {
      why: "The same failure, seen from the entry: the patch is refused, so the module's chain stops before it, and the entry is what it was -- not an error of its own that only a read of that entry reports.",
      legacy: {
        source: recordSource,
        failed: {
          patch: 0,
          message:
            "Cannot write the .jsonValues() entry '/a' from a '_type: \"json\"' marker: a marker says the content is in the entry's own file, so write the entry's CONTENT here, not the module's Source",
        },
        skipped: [],
        entries: {
          "/a": {
            error:
              "Cannot write the .jsonValues() entry '/a' from a '_type: \"json\"' marker: a marker says the content is in the entry's own file, so write the entry's CONTENT here, not the module's Source",
          },
          "/b": {
            error:
              "Cannot write the .jsonValues() entry '/a' from a '_type: \"json\"' marker: a marker says the content is in the entry's own file, so write the entry's CONTENT here, not the module's Source",
          },
        },
        patchesUnchanged: true,
      },
    },
  },
  {
    name: "an entry moved from a key that does not exist",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [[{ op: "move", from: ["/z"], path: ["/renamed"] }]],
    differs: {
      why: "The module refused the patch (there is no /z to remove) while the entry read reported an error of its own for /renamed. The patch is refused, so /renamed does not exist.",
      legacy: {
        source: recordSource,
        failed: {
          patch: 0,
          message: "Cannot remove from non-object/array",
        },
        skipped: [],
        entries: {
          "/a": { content: { title: "A", order: 1 } },
          "/b": { content: { title: "B", order: 2 } },
          "/renamed": {
            error:
              "Cannot resolve 'move' of jsonValues entry '/renamed' from its own content",
          },
          "/z": "missing",
        },
        patchesUnchanged: true,
      },
    },
  },
  {
    name: "a test op on a whole entry",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [[{ op: "test", path: ["/a"], value: { title: "A", order: 1 } }]],
    differs: {
      why: "The commit refuses a test of a whole entry ('Unsupported op'), and the old read wrote a marker with a patch_id for it, as if it were a copy: the Studio and a draft page then showed a patch publishing could not apply. The read refuses it too now.",
      legacy: {
        source: { "/a": { _type: "json", patch_id: "p1" }, "/b": marker },
        failed: null,
        skipped: [],
        entries: {
          "/a": { content: { title: "A", order: 1 } },
          "/b": { content: { title: "B", order: 2 } },
        },
        patchesUnchanged: true,
      },
    },
  },
  {
    name: "content moved between two entries",
    schema: entriesSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [[{ op: "move", from: ["/a", "title"], path: ["/b", "title"] }]],
    differs: {
      why: "The commit refuses it ('Cannot move between different jsonValues entries'). The old read rebased `from` onto the destination entry, so it moved /b's own title onto itself and left /a's where it was: a draft of a patch that cannot be published.",
      legacy: {
        source: recordSource,
        failed: null,
        skipped: [],
        entries: {
          "/a": { content: { title: "A", order: 1 } },
          "/b": { content: { title: "B", order: 2 } },
        },
        patchesUnchanged: true,
      },
    },
  },
  {
    name: "a nullable record replaced by null",
    schema: nullableRecordSchema,
    source: recordSource,
    entries: recordEntries,
    patches: [[{ op: "replace", path: [], value: null }]],
    differs: {
      why: "The record is gone, and its entries with it. The old entry read never looked at the module and kept answering each entry's content.",
      legacy: {
        source: null,
        failed: null,
        skipped: [],
        entries: {
          "/a": { content: { title: "A", order: 1 } },
          "/b": { content: { title: "B", order: 2 } },
        },
        patchesUnchanged: true,
      },
    },
  },
];

describe("the engine's conformance cases", () => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    // Each engine gets its own copy of the patches, so one mutating them
    // cannot change what the other sees.
    const legacy = runLegacy(structuredClone(c));
    const current = runNew(structuredClone(c));
    if (c.differs === undefined) {
      expect(current).toEqual(legacy);
    } else {
      expect(legacy).toEqual(
        c.differs.legacy === "mutates-the-patch"
          ? { ...current, patchesUnchanged: false }
          : c.differs.legacy,
      );
      expect(current).not.toEqual(legacy);
    }
    expect(current.patchesUnchanged).toBe(true);
  });

  /*
   * What the new engine answers where the two differ: written out, so the
   * decision is in the test and not only in prose.
   */
  test("where they differ, the new engine's answers", () => {
    const byName = new Map(cases.map((c) => [c.name, c]));
    const run = (name: string) => {
      const c = byName.get(name);
      if (c === undefined) throw new Error(`no case ${name}`);
      return runNew(structuredClone(c));
    };
    expect(
      run("a file op inside an entry, before the value it marks").entries["/a"],
    ).toEqual({ content: { hero: { ...image, patch_id: "p1" } } });
    expect(
      run("an entry edit after the module's chain stopped").entries["/a"],
    ).toEqual({ content: { title: "A", order: 1 } });
    expect(run("a whole record written with markers").entries).toEqual({
      "/a": { content: { title: "A", order: 1 } },
      "/b": { content: { title: "B", order: 2 } },
    });
    expect(
      run("an entry moved from a key that does not exist").entries,
    ).toEqual({
      "/a": { content: { title: "A", order: 1 } },
      "/b": { content: { title: "B", order: 2 } },
      "/renamed": "missing",
      "/z": "missing",
    });
    expect(run("a test op on a whole entry")).toMatchObject({
      source: recordSource,
      failed: {
        patch: 0,
        message:
          "Unsupported op 'test' on jsonValues entry '/a' (supported: add, remove, replace, move, copy)",
      },
    });
    expect(run("content moved between two entries")).toMatchObject({
      failed: {
        patch: 0,
        message: "Cannot 'move' between different jsonValues entries",
      },
    });
    expect(run("a module whose content became null")).toMatchObject({
      source: null,
      failed: null,
    });
    expect(run("a nullable record replaced by null").entries).toEqual({
      "/a": "missing",
      "/b": "missing",
    });
  });
});

/*
 * A `test` op fails its patch when the path is missing or the value there is
 * not deeply equal (RFC 6902, 4.6). Both engines agree on that, as they must,
 * so it is not a `differs`: it is written out here because both used to
 * answer that a `test` never fails, and the cases alone would not say which.
 */
test("a test op's answers", () => {
  const run = (name: string) => {
    const c = cases.find((c) => c.name === name);
    if (c === undefined) throw new Error(`no case ${name}`);
    return runNew(structuredClone(c));
  };
  expect(
    run("a test op that matches, deeply, lets the patch through"),
  ).toMatchObject({
    source: {
      title: "after the test",
      tags: ["a", "b", "c"],
      hero: null,
      nested: { deep: { value: 1 } },
    },
    failed: null,
  });
  expect(run("a test op whose value differs fails the patch")).toEqual({
    source: pageSource,
    failed: { patch: 0, message: "Test failed" },
    skipped: [1],
    entries: {},
    patchesUnchanged: true,
  });
  expect(
    run("a test op on a path that does not exist fails the patch"),
  ).toMatchObject({
    source: pageSource,
    failed: { patch: 0, message: "Path refers to non-existing object/array" },
  });
});

/*
 * Plain JSON, many times over: random documents and random patches, through
 * both engines. `JSONOps` is what the old engine was, and the new one's
 * copy-on-write ops have to give its results and its errors.
 */
describe("random patches on plain JSON", () => {
  function prng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }
  test.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i", (seed) => {
    const random = prng(seed);
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(random() * xs.length)];
    const leaf = (): JSONValue =>
      pick<JSONValue>(["x", "y", 1, 2, true, null, ""]);
    const doc = (depth: number): JSONValue => {
      if (depth === 0 || random() < 0.3) return leaf();
      if (random() < 0.5) {
        return Array.from({ length: Math.floor(random() * 4) }, () =>
          doc(depth - 1),
        );
      }
      const o: { [key: string]: JSONValue } = {};
      for (const k of ["a", "b", "c"].slice(0, 1 + Math.floor(random() * 3))) {
        o[k] = doc(depth - 1);
      }
      return o;
    };
    const segment = () => pick(["a", "b", "c", "0", "1", "2", "-", "01", "x"]);
    const path = (): string[] =>
      Array.from({ length: Math.floor(random() * 4) }, segment);
    const nonEmpty = (): [string, ...string[]] => [segment(), ...path()];
    // Never written at the root: a root that became null, "", 0 or false is
    // a known difference (see "a module whose content became null"), and
    // the root ops have cases of their own above.
    const op = (): Operation => {
      switch (pick(["add", "remove", "replace", "move", "copy", "test"])) {
        case "add":
          return { op: "add", path: nonEmpty(), value: doc(2) };
        case "remove":
          return { op: "remove", path: nonEmpty() };
        case "replace":
          return { op: "replace", path: nonEmpty(), value: doc(2) };
        case "move":
          return { op: "move", from: nonEmpty(), path: nonEmpty() };
        case "copy":
          return { op: "copy", from: path(), path: nonEmpty() };
        default:
          return { op: "test", path: path(), value: leaf() };
      }
    };
    for (let round = 0; round < 150; round++) {
      const c: Case = {
        name: `seed ${seed} round ${round}`,
        source: doc(4),
        patches: Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
          Array.from({ length: 1 + Math.floor(random() * 3) }, op),
        ),
      };
      const legacy = runLegacy(structuredClone(c));
      const current = runNew(structuredClone(c));
      // The one known difference: the old engine could mutate the patch it
      // applied (see the case above). Everything else must agree.
      // The case rides along, so a failure shows what was applied.
      expect({
        case: { source: c.source, patches: c.patches },
        outcome: { ...current, patchesUnchanged: true },
      }).toEqual({
        case: { source: c.source, patches: c.patches },
        outcome: { ...legacy, patchesUnchanged: true },
      });
    }
  });
});
