import { Schema } from ".";
import { initVal } from "../initVal";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";
import { isInlineRender } from "../render";

const { s, c } = initVal();

const authors = c.define(
  "/content/authors.val.ts",
  s.record(s.object({ name: s.string() })),
  { fredrik: { name: "Fredrik" } },
);

describe("Schema.render({ as: 'inline' })", () => {
  test("serialize: defaults to no render", () => {
    const serialized = s.object({ a: s.string() })["executeSerialize"]();
    expect(serialized.render).toBe(undefined);
  });

  test("serialize: render({ as: 'inline' }) is carried in the serialized schema", () => {
    const serialized = s
      .object({ a: s.string() })
      .render({ as: "inline" })
      ["executeSerialize"]();
    expect(serialized.render).toEqual({ as: "inline" });
  });

  test("inline render serializes across every schema type", () => {
    const schemas: Schema<SelectorSource>[] = [
      s.string().render({ as: "inline" }),
      s.number().render({ as: "inline" }),
      s.boolean().render({ as: "inline" }),
      s.literal("a").render({ as: "inline" }),
      s.date().render({ as: "inline" }),
      s.datetime().render({ as: "inline" }),
      s.color().render({ as: "inline" }),
      s.route().render({ as: "inline" }),
      s.richtext().render({ as: "inline" }),
      s.image().render({ as: "inline" }),
      s.file().render({ as: "inline" }),
      s.array(s.string()).render({ as: "inline" }),
      s.object({ a: s.string() }).render({ as: "inline" }),
      s.record(s.string()).render({ as: "inline" }),
      s
        .union("type", s.object({ type: s.literal("a") }))
        .render({ as: "inline" }),
      s.keyOf(authors).render({ as: "inline" }),
    ];
    for (const schema of schemas) {
      expect(schema["executeSerialize"]().render).toEqual({ as: "inline" });
    }
  });

  test("render is preserved regardless of chaining order", () => {
    const before = s
      .object({ a: s.string() })
      .render({ as: "inline" })
      .describe("desc")
      ["executeSerialize"]();
    const after = s
      .object({ a: s.string() })
      .describe("desc")
      .render({ as: "inline" })
      ["executeSerialize"]();
    expect(before.render).toEqual({ as: "inline" });
    expect(after.render).toEqual({ as: "inline" });
  });

  test("render is preserved through nullable(), readonly(), hidden() and validate()", () => {
    const base = s.object({ a: s.string() }).render({ as: "inline" });
    for (const schema of [
      base.nullable(),
      base.readonly(),
      base.hidden(),
      base.validate(() => false),
    ]) {
      expect(schema["executeSerialize"]().render).toEqual({ as: "inline" });
    }
  });

  test("a second render replaces the first (last wins)", () => {
    expect(
      s
        .string()
        .render({ as: "textarea" })
        .render({ as: "inline" })
        ["executeSerialize"]().render,
    ).toEqual({ as: "inline" });
    expect(
      s
        .string()
        .render({ as: "inline" })
        .render({ as: "textarea" })
        ["executeSerialize"]().render,
    ).toEqual({ as: "textarea" });
  });

  test("render does not mutate the schema it was called on", () => {
    const base = s.object({ a: s.string() });
    base.render({ as: "inline" });
    expect(base["executeSerialize"]().render).toBe(undefined);
  });

  test("render survives a serialize -> deserialize -> serialize round-trip on a nested page-builder shape", () => {
    // The motivating shape: sortable lists of inline objects, nested.
    const schema = s.array(
      s
        .object({
          title: s.string(),
          sections: s.array(
            s
              .object({
                title: s.string(),
                content: s.richtext(),
              })
              .render({ as: "inline" }),
          ),
        })
        .render({ as: "inline" }),
    );
    const serialized = schema["executeSerialize"]();
    const roundTripped = deserializeSchema(serialized)["executeSerialize"]();
    expect(roundTripped).toEqual(serialized);
    if (roundTripped.type !== "array" || roundTripped.item.type !== "object") {
      throw new Error("expected array of object schema");
    }
    expect(roundTripped.item.render).toEqual({ as: "inline" });
    const sections = roundTripped.item.items.sections;
    if (sections.type !== "array") {
      throw new Error("expected array schema");
    }
    expect(sections.item.render).toEqual({ as: "inline" });
  });

  test("string keeps its own render layouts alongside inline", () => {
    expect(
      s.string().render({ as: "textarea" })["executeSerialize"]().render,
    ).toEqual({ as: "textarea" });
    expect(
      s.string().render({ as: "inline" })["executeSerialize"]().render,
    ).toEqual({ as: "inline" });
    const roundTripped = deserializeSchema(
      s.string().render({ as: "inline" })["executeSerialize"](),
    )["executeSerialize"]();
    expect(roundTripped.render).toEqual({ as: "inline" });
  });

  test("an inline item does not change the container's preview", () => {
    const plain = s.array(
      s.object({ name: s.string() }).preview(({ val }) => ({
        title: val.name,
      })),
    );
    const inline = s.array(
      s
        .object({ name: s.string() })
        .preview(({ val }) => ({ title: val.name }))
        .render({ as: "inline" }),
    );
    const src = [{ name: "Ada" }];
    expect(inline["executePreview"]("/test.val.ts" as SourcePath, src)).toEqual(
      plain["executePreview"]("/test.val.ts" as SourcePath, src),
    );
  });

  test("render does not change validation results", () => {
    const path = "/test" as SourcePath;
    const plain = s.object({ a: s.string().minLength(3) });
    const inline = s
      .object({ a: s.string().minLength(3) })
      .render({ as: "inline" });
    expect(inline["executeValidate"](path, { a: "ok" })).toEqual(
      plain["executeValidate"](path, { a: "ok" }),
    );
    expect(inline["executeValidate"](path, { a: "abc" })).toEqual(
      plain["executeValidate"](path, { a: "abc" }),
    );
  });
});

describe("isInlineRender", () => {
  test("reads the render off the schema it was declared on", () => {
    expect(
      isInlineRender(s.string().render({ as: "inline" })["executeSerialize"]()),
    ).toBe(true);
    expect(isInlineRender(s.string()["executeSerialize"]())).toBe(false);
    expect(
      isInlineRender(
        s
          .string()
          .render({ as: "code", language: "typescript" })
          ["executeSerialize"](),
      ),
    ).toBe(false);
  });

  test("a tagged union is inline when its VARIANTS declare it", () => {
    // How a page-builder list is written: the render goes on the blocks, one
    // per block type, and the union is the dispatch between them. The union
    // schema itself carries no render at all, so reading `render` off the
    // array's item schema alone answers `false` for the very shape the render
    // exists for.
    const blocks = s.union(
      "type",
      s
        .object({ type: s.literal("text"), text: s.string() })
        .render({ as: "inline" }),
      s
        .object({ type: s.literal("code"), code: s.string() })
        .render({ as: "inline" }),
    );
    const serialized = blocks["executeSerialize"]();
    expect(serialized.render).toBe(undefined);
    expect(isInlineRender(serialized)).toBe(true);
  });

  test("one inline variant is enough", () => {
    // `some`, not `every`: the row draws the union's own editor either way, so
    // a variant added later without a render must not silently turn the whole
    // list back into preview rows.
    const serialized = s
      .union(
        "type",
        s
          .object({ type: s.literal("text"), text: s.string() })
          .render({ as: "inline" }),
        s.object({ type: s.literal("code"), code: s.string() }),
      )
      ["executeSerialize"]();
    expect(isInlineRender(serialized)).toBe(true);
  });

  test("a union with no inline variant is not inline", () => {
    const serialized = s
      .union(
        "type",
        s.object({ type: s.literal("text"), text: s.string() }),
        s.object({ type: s.literal("code"), code: s.string() }),
      )
      ["executeSerialize"]();
    expect(isInlineRender(serialized)).toBe(false);
  });

  test("the union's own render still counts", () => {
    const serialized = s
      .union(
        "type",
        s.object({ type: s.literal("text"), text: s.string() }),
        s.object({ type: s.literal("code"), code: s.string() }),
      )
      .render({ as: "inline" })
      ["executeSerialize"]();
    expect(isInlineRender(serialized)).toBe(true);
  });

  test("a string union is inline only when it says so itself", () => {
    expect(
      isInlineRender(
        s.union(s.literal("a"), s.literal("b"))["executeSerialize"](),
      ),
    ).toBe(false);
    expect(
      isInlineRender(
        s
          .union(s.literal("a"), s.literal("b"))
          .render({ as: "inline" })
          ["executeSerialize"](),
      ),
    ).toBe(true);
  });

  test("survives serialize -> deserialize", () => {
    const blocks = s.array(
      s.union(
        "type",
        s
          .object({ type: s.literal("text"), text: s.string() })
          .render({ as: "inline" }),
      ),
    );
    const roundTripped = deserializeSchema(blocks["executeSerialize"]())[
      "executeSerialize"
    ]();
    if (roundTripped.type !== "array") {
      throw new Error("expected array schema");
    }
    expect(isInlineRender(roundTripped.item)).toBe(true);
  });
});
