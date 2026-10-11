import { Schema } from ".";
import { initVal } from "../initVal";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";
import { isInlineRender } from "../render";
import { nextAppRouter } from "../router";

const { s, c } = initVal();

const authors = c.define(
  "/content/authors.val.ts",
  s.record(s.object({ name: s.string() })),
  { fredrik: { name: "Fredrik" } },
);

describe("Schema.render({ as: 'inline' })", () => {
  test("serialize: defaults to no render", () => {
    const serialized = s.array(s.string())["executeSerialize"]();
    expect(serialized.type === "array" && serialized.render).toBe(undefined);
  });

  test("serialize: carried on the CONTAINER, not on its item", () => {
    const serialized = s
      .array(s.object({ a: s.string() }))
      .render({ as: "inline" })
      ["executeSerialize"]();
    if (serialized.type !== "array") {
      throw new Error("expected array schema");
    }
    expect(serialized.render).toEqual({ as: "inline" });
    expect("render" in serialized.item).toBe(false);
  });

  test("only array, record and keyOf take a render", () => {
    const schemas: Schema<SelectorSource>[] = [
      s.array(s.string()).render({ as: "inline" }),
      s.record(s.string()).render({ as: "inline" }),
      s.keyOf(authors).render({ as: "inline" }),
    ];
    for (const schema of schemas) {
      const serialized = schema["executeSerialize"]();
      if (
        serialized.type !== "array" &&
        serialized.type !== "record" &&
        serialized.type !== "keyOf"
      ) {
        throw new Error("expected a schema that takes a render");
      }
      expect(serialized.render).toEqual({ as: "inline" });
    }
  });

  test("render is preserved regardless of chaining order", () => {
    const before = s
      .array(s.string())
      .render({ as: "inline" })
      .describe("desc")
      ["executeSerialize"]();
    const after = s
      .array(s.string())
      .describe("desc")
      .render({ as: "inline" })
      ["executeSerialize"]();
    expect(isInlineRender(before)).toBe(true);
    expect(isInlineRender(after)).toBe(true);
  });

  test("render is preserved through every chained builder", () => {
    const array = s.array(s.string()).render({ as: "inline" });
    const record = s.record(s.string()).render({ as: "inline" });
    const chained: Schema<SelectorSource>[] = [
      array.nullable(),
      array.readonly(),
      array.hidden(),
      array.validate(() => false),
      array.preview(() => ({ title: "x" })),
      record.nullable(),
      record.readonly(),
      record.hidden(),
      record.validate(() => false),
      record.preview(() => ({ title: "x" })),
    ];
    for (const schema of chained) {
      expect(isInlineRender(schema["executeSerialize"]())).toBe(true);
    }
  });

  test("a second render replaces the first (last wins)", () => {
    const twice = s
      .array(s.string())
      .render({ as: "inline" })
      .render({ as: "inline" })
      ["executeSerialize"]();
    expect(isInlineRender(twice)).toBe(true);
  });

  test("render does not mutate the schema it was called on", () => {
    const base = s.array(s.string());
    base.render({ as: "inline" });
    expect(isInlineRender(base["executeSerialize"]())).toBe(false);
  });

  test("render survives a serialize -> deserialize -> serialize round-trip on a nested page-builder shape", () => {
    // The motivating shape: sortable lists of inline objects, nested.
    const schema = s
      .array(
        s.object({
          title: s.string(),
          sections: s
            .array(s.object({ title: s.string(), content: s.richtext() }))
            .render({ as: "inline" }),
          tags: s.record(s.string()).render({ as: "inline" }),
        }),
      )
      .render({ as: "inline" });
    const serialized = schema["executeSerialize"]();
    const roundTripped = deserializeSchema(serialized)["executeSerialize"]();
    expect(roundTripped).toEqual(serialized);
    if (roundTripped.type !== "array" || roundTripped.item.type !== "object") {
      throw new Error("expected array of object schema");
    }
    expect(isInlineRender(roundTripped)).toBe(true);
    expect(isInlineRender(roundTripped.item.items.sections)).toBe(true);
    expect(isInlineRender(roundTripped.item.items.tags)).toBe(true);
  });

  test("a keyOf render round-trips", () => {
    const serialized = s
      .keyOf(authors)
      .render({ as: "inline" })
      ["executeSerialize"]();
    expect(deserializeSchema(serialized)["executeSerialize"]()).toEqual(
      serialized,
    );
  });

  test("an inline list does not change its preview", () => {
    const item = s
      .object({ name: s.string() })
      .preview(({ val }) => ({ title: val.name }));
    const plain = s.array(item);
    const inline = s.array(item).render({ as: "inline" });
    const src = [{ name: "Ada" }];
    expect(inline["executePreview"]("/test.val.ts" as SourcePath, src)).toEqual(
      plain["executePreview"]("/test.val.ts" as SourcePath, src),
    );
  });

  test("render does not change validation results", () => {
    const path = "/test" as SourcePath;
    const plain = s.array(s.string().minLength(3));
    const inline = s.array(s.string().minLength(3)).render({ as: "inline" });
    expect(inline["executeValidate"](path, ["ok"])).toEqual(
      plain["executeValidate"](path, ["ok"]),
    );
    expect(inline["executeValidate"](path, ["abc"])).toEqual(
      plain["executeValidate"](path, ["abc"]),
    );
  });

  describe("pages and media have UIs of their own", () => {
    test("render on a router throws", () => {
      expect(() =>
        s.router(nextAppRouter, s.string()).render({ as: "inline" }),
      ).toThrow(/s\.router/);
    });

    test("router after render throws too", () => {
      expect(() =>
        s.record(s.string()).render({ as: "inline" }).router(nextAppRouter),
      ).toThrow(/s\.router/);
    });

    test("render on an imageset or fileset throws", () => {
      expect(() =>
        s.imageset({ dir: "/public/val/images" }).render({ as: "inline" }),
      ).toThrow(/s\.imageset/);
      expect(() =>
        s
          .fileset({ accept: "application/pdf", dir: "/public/val/files" })
          .render({ as: "inline" }),
      ).toThrow(/s\.fileset/);
    });
  });
});

describe("isInlineRender", () => {
  test("reads the render off the CONTAINER", () => {
    expect(
      isInlineRender(
        s.array(s.string()).render({ as: "inline" })["executeSerialize"](),
      ),
    ).toBe(true);
    expect(
      isInlineRender(
        s.record(s.string()).render({ as: "inline" })["executeSerialize"](),
      ),
    ).toBe(true);
    expect(isInlineRender(s.array(s.string())["executeSerialize"]())).toBe(
      false,
    );
    expect(isInlineRender(s.record(s.string())["executeSerialize"]())).toBe(
      false,
    );
  });

  test("a page-builder list of tagged blocks is inline from the list alone", () => {
    const serialized = s
      .array(
        s.discriminatedUnion(
          "type",
          s.object({ type: s.literal("text"), text: s.string() }),
          s.object({ type: s.literal("code"), code: s.string() }),
        ),
      )
      .render({ as: "inline" })
      ["executeSerialize"]();
    expect(isInlineRender(serialized)).toBe(true);
    if (serialized.type !== "array") {
      throw new Error("expected array schema");
    }
    // The union is the item; it says nothing about the list it is in.
    expect(isInlineRender(serialized.item)).toBe(false);
  });

  test("reaches one level down: a nested list keeps its own default", () => {
    const serialized = s
      .array(s.object({ tags: s.array(s.string()) }))
      .render({ as: "inline" })
      ["executeSerialize"]();
    if (serialized.type !== "array" || serialized.item.type !== "object") {
      throw new Error("expected array of object schema");
    }
    expect(isInlineRender(serialized)).toBe(true);
    expect(isInlineRender(serialized.item.items.tags)).toBe(false);
  });

  test("a keyOf's render is about the field, not a list — never inline here", () => {
    expect(
      isInlineRender(
        s.keyOf(authors).render({ as: "inline" })["executeSerialize"](),
      ),
    ).toBe(false);
  });

  test("a leaf is never a container", () => {
    expect(isInlineRender(s.string()["executeSerialize"]())).toBe(false);
    expect(
      isInlineRender(s.object({ a: s.string() })["executeSerialize"]()),
    ).toBe(false);
  });

  test("survives serialize -> deserialize", () => {
    const blocks = s
      .array(
        s.discriminatedUnion(
          "type",
          s.object({ type: s.literal("text"), text: s.string() }),
        ),
      )
      .render({ as: "inline" });
    const roundTripped = deserializeSchema(blocks["executeSerialize"]())[
      "executeSerialize"
    ]();
    expect(isInlineRender(roundTripped)).toBe(true);
  });
});
