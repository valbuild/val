import {
  Internal,
  initVal,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import {
  buildDuplicatePatch,
  buildEmptyAtPathPatch,
  describeContainerAtPath,
} from "./aiSourceToolPatches";

const { s, c } = initVal();

function serialize(valModule: ReturnType<typeof c.define>) {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) throw new Error("Schema not found");
  const source = Internal.getSource(valModule);
  return { schema: schema as SerializedSchema, source: source as Source };
}

const item = s.object({ title: s.string(), order: s.number() });

const recordModule = serialize(
  c.define("/content/posts.val.ts", s.record(item), {
    first: { title: "First", order: 1 },
  }),
);

const nestedModule = serialize(
  c.define(
    "/content/page.val.ts",
    s.object({
      title: s.string(),
      items: s.array(item),
      byKey: s.record(item),
      body: s.richtext({ h1: true }),
      hero: s.image(),
      gallery: s.images({
        directory: "/public/val/images",
        accept: "image/png",
      }),
      docs: s.files({
        directory: "/public/val/docs",
        accept: "application/pdf",
      }),
    }),
    {
      title: "Page",
      items: [{ title: "One", order: 1 }],
      byKey: { a: { title: "A", order: 1 } },
      body: [{ tag: "h1", children: ["Heading"] }],
      hero: {
        path: "/public/val/images/hero.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
      gallery: {
        "/public/val/images/one.png": {
          width: 1,
          height: 1,
          mimeType: "image/png",
          alt: null,
        },
      },
      docs: {
        "/public/val/docs/a.pdf": { mimeType: "application/pdf" },
      },
    },
  ),
);

describe("decideOp, via buildEmptyAtPathPatch", () => {
  test("a new entry in a record or array is an add", () => {
    for (const [path, mod] of [
      [["byKey", "new"], nestedModule],
      [["items", "1"], nestedModule],
    ] as const) {
      const res = buildEmptyAtPathPatch(
        { destinationPath: [...path] },
        mod.schema,
        mod.source,
      );
      expect(res.kind).toBe("ok");
      if (res.kind !== "ok") return;
      expect(res.patch[0].op).toBe("add");
    }
  });

  test("an object property is a replace, because the slot already exists", () => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: ["title"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.patch[0].op).toBe("replace");
  });

  test("the module root is a replace", () => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: [] },
      recordModule.schema,
      recordModule.source,
    );
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.patch[0]).toMatchObject({ op: "replace", path: [] });
  });

  test("a path that does not resolve is an error, not a patch", () => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: ["nope", "deeper"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("error");
  });

  // decideOp used to look only at the destination's PARENT. For a new gallery
  // entry the parent IS the gallery record, which looks like any other record,
  // so it emitted a plain `add`; and for the gallery itself the parent is the
  // enclosing object, so it emitted a plain `replace` over the whole gallery.
  // Both bypass the gallery flow the tool descriptions promise to redirect to.
  test.each([
    [
      "a new entry in an images gallery",
      ["gallery", "/public/val/images/new.png"],
    ],
    ["the images gallery itself", ["gallery"]],
    ["a new entry in a files gallery", ["docs", "/public/val/docs/new.pdf"]],
    ["the files gallery itself", ["docs"]],
  ])("redirects %s to the gallery tool", (_label, destinationPath) => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: [...destinationPath] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("wrong-tool");
    if (res.kind !== "wrong-tool") return;
    expect(res.suggestedTool).toBe("add_session_image_to_gallery");
  });

  test.each([
    ["the richtext value itself", ["body"]],
    ["inside richtext", ["body", "0"]],
  ])("redirects %s to create_patch", (_label, destinationPath) => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: [...destinationPath] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("wrong-tool");
    if (res.kind !== "wrong-tool") return;
    expect(res.suggestedTool).toBe("create_patch");
  });
});

describe("buildDuplicatePatch", () => {
  test("copies the value at the source path", () => {
    const res = buildDuplicatePatch(
      { sourcePath: ["byKey", "a"], destinationPath: ["byKey", "b"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.patch).toEqual([
      { op: "add", path: ["byKey", "b"], value: { title: "A", order: 1 } },
    ]);
  });

  test("a source path that does not exist is an error", () => {
    const res = buildDuplicatePatch(
      { sourcePath: ["byKey", "missing"], destinationPath: ["byKey", "b"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("error");
    if (res.kind !== "error") return;
    expect(res.message).toContain("does not exist");
  });

  test("the destination is checked even when the source is fine", () => {
    const res = buildDuplicatePatch(
      {
        sourcePath: ["byKey", "a"],
        destinationPath: ["gallery", "/public/val/images/new.png"],
      },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("wrong-tool");
  });
});

describe("writing over an existing entry", () => {
  test("duplicating onto an occupied record key is refused", () => {
    // Silent data loss otherwise: `add` into a record replaces whatever is at
    // the key, the patch is valid, the content stays valid, and the entry that
    // was there is simply gone.
    const res = buildDuplicatePatch(
      { sourcePath: ["byKey", "a"], destinationPath: ["byKey", "a"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("error");
    if (res.kind !== "error") return;
    expect(res.message).toContain("already exists");
  });

  test("scaffolding onto an occupied record key is refused", () => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: ["byKey", "a"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("error");
    if (res.kind !== "error") return;
    expect(res.message).toContain("already exists");
  });

  test("a free record key is still allowed", () => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: ["byKey", "free"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("ok");
  });

  test("an occupied array index is allowed, because add inserts there", () => {
    // Different op semantics, so the same guard would be wrong: JSON Patch
    // `add` at an index shifts the rest along rather than overwriting.
    const res = buildEmptyAtPathPatch(
      { destinationPath: ["items", "0"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("ok");
  });

  test("an object field is allowed, because replacing one is the point", () => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: ["title"] },
      nestedModule.schema,
      nestedModule.source,
    );
    expect(res.kind).toBe("ok");
  });

  test("a record module's own root key is checked too", () => {
    const res = buildEmptyAtPathPatch(
      { destinationPath: ["first"] },
      recordModule.schema,
      recordModule.source,
    );
    expect(res.kind).toBe("error");
  });
});

describe("describeContainerAtPath", () => {
  test.each([
    ["a record module root", "record", recordModule, []],
    ["an object module root", "object", nestedModule, []],
    ["a nested record", "record", nestedModule, ["byKey"]],
    ["an array", "array", nestedModule, ["items"]],
    ["an images gallery", "gallery", nestedModule, ["gallery"]],
    ["a files gallery", "gallery", nestedModule, ["docs"]],
    ["richtext", "richtext", nestedModule, ["body"]],
  ] as const)("classifies %s as %s", (_label, expected, mod, path) => {
    const res = describeContainerAtPath(mod.schema, mod.source, [...path]);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.container).toBe(expected);
  });

  // These are all plain objects or arrays at runtime, so classifying by
  // `typeof` alone reported them as containers - which let get_record_keys hand
  // back an image ref's `_ref`/`_type` or a richtext node's `tag`/`children` as
  // if they were record keys.
  test.each([
    ["an image source", ["hero"]],
    ["a string", ["title"]],
    ["a richtext node", ["body", "0"]],
    ["a gallery entry", ["gallery", "/public/val/images/one.png"]],
  ])("refuses %s", (_label, path) => {
    const res = describeContainerAtPath(
      nestedModule.schema,
      nestedModule.source,
      [...path],
    );
    expect(res.kind).toBe("error");
  });

  test("a path missing from the source is an error", () => {
    const res = describeContainerAtPath(
      nestedModule.schema,
      nestedModule.source,
      ["byKey", "nope"],
    );
    expect(res.kind).toBe("error");
    if (res.kind !== "error") return;
    expect(res.message).toContain("does not exist");
  });
});
