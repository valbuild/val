import { initVal, Schema, SelectorSource } from "@valbuild/core";
import { SerializedSchema } from "./SerializedSchema";

const { s, c } = initVal();

/**
 * These z.objects STRIP unknown keys, so anything the serialized schema carries
 * but this parser does not declare is dropped between the server and the
 * Studio - silently, and only for the field that forgot it. That is what these
 * round-trips are here to catch.
 */
const serialize = (schema: Schema<SelectorSource>) =>
  schema["executeSerialize"]();

describe("SerializedSchema round-trips", () => {
  test("richtext keeps its options", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.richtext({ bold: true, ul: true, a: true })),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "richtext",
      options: { bold: true, ul: true, a: true },
    });
  });

  test("richtext keeps maxLength and minLength", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.richtext({ bold: true }).minLength(2).maxLength(10)),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "richtext",
      options: { minLength: 2, maxLength: 10 },
    });
  });

  test("richtext keeps the schemas its `a` and `img` options carry", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.richtext({ a: s.route(), img: s.image() })),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "richtext",
      options: { a: { type: "route" }, img: { type: "image" } },
    });
  });

  // Not a strip but an outright rejection: `settings` was in the TypeScript
  // union and absent from this one, so /schema answered 500 for every project
  // with a settings module rather than dropping a field.
  test("settings parses, nested sections and all", () => {
    const parsed = SerializedSchema.safeParse(serialize(s.settings()));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "settings",
      items: {
        assistant: {
          type: "settings",
          items: {
            enabled: { type: "boolean" },
            context: { type: "string" },
            tone: { type: "string" },
          },
        },
      },
    });
  });
});

/**
 * Every key the serialized schema carried, or the paths of the ones that did
 * not survive.
 *
 * Recursive, and driven by what `executeSerialize` actually produced rather
 * than by a list kept here - which is the point. A field added to a serialized
 * schema and forgotten in the parser fails this without anyone remembering to
 * come back and assert it, and the failure names the path it was dropped from.
 *
 * Only checks that keys SURVIVE. A key the parser declares and the schema never
 * writes is not a bug, so extra keys on the parsed side are ignored.
 */
function droppedKeys(before: unknown, after: unknown, path = ""): string[] {
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) {
      return [`${path}: array became ${typeof after}`];
    }
    return before.flatMap((item, i) =>
      droppedKeys(item, after[i], `${path}[${i}]`),
    );
  }
  if (before !== null && typeof before === "object") {
    if (after === null || typeof after !== "object") {
      return [`${path}: object became ${String(after)}`];
    }
    const parsed = after as Record<string, unknown>;
    return Object.entries(before as Record<string, unknown>).flatMap(
      ([key, value]) => {
        // `executeSerialize` writes `undefined` for absent optional fields, and
        // JSON drops those in transit anyway - not something to hold the parser to.
        if (value === undefined) {
          return [];
        }
        if (!(key in parsed)) {
          return [`${path}.${key} (was ${JSON.stringify(value)})`];
        }
        return droppedKeys(value, parsed[key], `${path}.${key}`);
      },
    );
  }
  return [];
}

function expectNothingDropped(schema: Schema<SelectorSource>) {
  const serialized = serialize(schema);
  const parsed = SerializedSchema.safeParse(serialized);
  if (!parsed.success) {
    throw new Error(`did not parse at all: ${parsed.error.message}`);
  }
  expect(droppedKeys(serialized, parsed.data)).toEqual([]);
}

/**
 * The parser used to declare `customValidate` and `description` on six of the
 * eighteen schemas and drop them on the other twelve, and to drop `remote` and
 * `referencedModule` on both media schemas. It is a strip rather than a
 * rejection, so nothing failed and nothing said so: on the history path - the
 * one place a parsed schema is consumed rather than merely validated
 * (`getModuleAtCommit`, `getHistoricalPatchSet`) - a historical `.validate()`
 * stopped existing, a remote image read as local, and a gallery-backed field
 * lost the gallery it reads its metadata from.
 */
describe("SerializedSchema keeps every field the schema wrote", () => {
  const gallery = c.define(
    "/test/gallery.val.ts",
    s.images({ directory: "/public/val" }),
    {},
  );
  const cases: [string, Schema<SelectorSource>][] = [
    [
      "string",
      s
        .string()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "literal",
      s
        .literal("a")
        .validate(() => false)
        .describe("d"),
    ],
    [
      "boolean",
      s
        .boolean()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "number",
      s
        .number()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "object",
      s
        .object({ a: s.string() })
        .validate(() => false)
        .describe("d"),
    ],
    [
      "array",
      s
        .array(s.string())
        .validate(() => false)
        .describe("d"),
    ],
    [
      "union of literals",
      s
        .union(s.literal("a"), s.literal("b"))
        .validate(() => false)
        .describe("d"),
    ],
    [
      "union of objects",
      s
        .union("k", s.object({ k: s.literal("a") }))
        .validate(() => false)
        .describe("d"),
    ],
    [
      "richtext",
      s
        .richtext({})
        .validate(() => false)
        .describe("d"),
    ],
    [
      "record",
      s
        .record(s.string())
        .validate(() => false)
        .describe("d"),
    ],
    [
      "keyOf",
      s
        .keyOf(gallery)
        .validate(() => false)
        .describe("d"),
    ],
    [
      "image",
      s
        .image()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "remote image",
      s
        .image()
        .remote()
        .validate(() => false)
        .describe("d"),
    ],
    ["gallery-backed image", s.image(gallery).describe("d")],
    [
      "file",
      s
        .file()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "remote file",
      s
        .file()
        .remote()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "date",
      s
        .date()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "datetime",
      s
        .datetime()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "color",
      s
        .color()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "code",
      s
        .code()
        .validate(() => false)
        .describe("d"),
    ],
    [
      "route",
      s
        .route()
        .validate(() => false)
        .describe("d"),
    ],
    ["settings", s.settings()],
  ];

  test.each(cases)("%s", (_name, schema) => {
    expectNothingDropped(schema);
  });

  // The four fields the strip actually cost, named so a regression says which
  // one rather than only where.
  test("a `.validate()` is still visible to the Studio", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.string().validate(() => false)),
    );
    expect(parsed.success && parsed.data).toMatchObject({
      type: "string",
      customValidate: true,
    });
  });

  test("a `.describe()` survives", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.string().describe("What this field is for")),
    );
    expect(parsed.success && parsed.data).toMatchObject({
      type: "string",
      description: "What this field is for",
    });
  });

  test("a remote image is still remote", () => {
    const parsed = SerializedSchema.safeParse(serialize(s.image().remote()));
    expect(parsed.success && parsed.data).toMatchObject({
      type: "image",
      remote: true,
    });
  });

  test("a gallery-backed image keeps its gallery", () => {
    const gallery = c.define(
      "/test/backing-gallery.val.ts",
      s.images({ directory: "/public/val" }),
      {},
    );
    const parsed = SerializedSchema.safeParse(serialize(s.image(gallery)));
    expect(parsed.success && parsed.data).toMatchObject({
      type: "image",
      referencedModule: "/test/backing-gallery.val.ts",
    });
  });
});
