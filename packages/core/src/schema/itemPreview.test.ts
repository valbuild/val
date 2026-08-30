import { Schema } from ".";
import { initVal } from "../initVal";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";

const { s, c } = initVal();

const authors = c.define(
  "/content/authors.val.ts",
  s.record(s.object({ name: s.string() })),
  { fredrik: { name: "Fredrik" } },
);

/**
 * `preview` is declared on the schema of the VALUE being previewed — the item,
 * not the container — and the container reifies its rows from it. See
 * `preview.ts` and `architecture/render-and-preview.md`.
 */
describe("item-level preview", () => {
  test("simple: an array previews rows from its item's preview", () => {
    const schema = s.array(
      s
        .object({ name: s.string() })
        .preview(({ val }) => ({ title: val.name })),
    );
    expect(
      schema["executePreview"]("/test.val.ts" as SourcePath, [
        { name: "Ada" },
        { name: "Grace" },
      ]),
    ).toStrictEqual({
      "/test.val.ts": {
        status: "success",
        data: {
          parent: "array",
          items: [
            [0, { title: "Ada", subtitle: undefined, image: undefined }],
            [1, { title: "Grace", subtitle: undefined, image: undefined }],
          ],
        },
      },
    });
  });

  test("simple: a record previews entries from its item's preview", () => {
    const schema = s.record(
      s
        .object({ name: s.string() })
        .preview(({ val }) => ({ title: val.name })),
    );
    expect(
      schema["executePreview"]("/test.val.ts" as SourcePath, {
        ada: { name: "Ada" },
      }),
    ).toStrictEqual({
      "/test.val.ts": {
        status: "success",
        data: {
          parent: "record",
          items: [
            ["ada", { title: "Ada", subtitle: undefined, image: undefined }],
          ],
        },
      },
    });
  });

  test("an item without a preview produces no rows preview", () => {
    const schema = s.array(s.object({ name: s.string() }));
    expect(
      schema["executePreview"]("/test.val.ts" as SourcePath, [{ name: "Ada" }]),
    ).toStrictEqual({});
  });

  test("preview serializes as a marker across every schema type", () => {
    const p = () => ({ title: "t" });
    const schemas: Schema<SelectorSource>[] = [
      s.string().preview(p),
      s.number().preview(p),
      s.boolean().preview(p),
      s.literal("a").preview(p),
      s.date().preview(p),
      s.datetime().preview(p),
      s.color().preview(p),
      s.route().preview(p),
      s.richtext().preview(p),
      s.image().preview(p),
      s.file().preview(p),
      s.array(s.string()).preview(p),
      s.object({ a: s.string() }).preview(p),
      s.record(s.string()).preview(p),
      s.union("type", s.object({ type: s.literal("a") })).preview(p),
      s.keyOf(authors).preview(p),
    ];
    for (const schema of schemas) {
      expect(schema["executeSerialize"]().preview).toBe(true);
    }
    expect(s.string()["executeSerialize"]().preview).toBe(undefined);
  });

  test("preview is kept when chaining, including through render", () => {
    const base = s
      .object({ name: s.string() })
      .preview(({ val }) => ({ title: val.name }));
    for (const item of [
      base,
      base.nullable(),
      base.readonly(),
      base.hidden(),
      base.describe("desc"),
      base.validate(() => false),
      base.render({ as: "inline" }),
    ]) {
      expect(item["executeSerialize"]().preview).toBe(true);
    }
  });

  test("a second preview replaces the first (last wins)", () => {
    const schema = s.array(
      s
        .object({ name: s.string() })
        .preview(({ val }) => ({ title: `first: ${val.name}` }))
        .preview(({ val }) => ({ title: `second: ${val.name}` })),
    );
    const res = schema["executePreview"]("/test.val.ts" as SourcePath, [
      { name: "Ada" },
    ]);
    const at = res["/test.val.ts" as SourcePath];
    if (at?.status !== "success" || at.data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(at.data.items).toEqual([
      [0, { title: "second: Ada", subtitle: undefined, image: undefined }],
    ]);
  });

  test("a string item previews with its own closure", () => {
    const schema = s.array(s.string().preview(({ val }) => ({ title: val })));
    const res = schema["executePreview"]("/test.val.ts" as SourcePath, [
      "hello",
    ]);
    const at = res["/test.val.ts" as SourcePath];
    if (at?.status !== "success" || at.data.parent !== "array") {
      throw new Error("expected an array preview");
    }
    expect(at.data.items).toEqual([
      [0, { title: "hello", subtitle: undefined, image: undefined }],
    ]);
  });

  describe("unions", () => {
    const blocks = s.array(
      s.union(
        "type",
        s
          .object({ type: s.literal("hero"), heading: s.string() })
          .preview(({ val }) => ({ title: `Hero: ${val.heading}` })),
        s
          .object({ type: s.literal("quote"), text: s.string() })
          .preview(({ val }) => ({ title: `Quote: ${val.text}` })),
        s.object({ type: s.literal("spacer"), size: s.number() }),
      ),
    );
    const src = [
      { type: "quote" as const, text: "Make it work" },
      { type: "spacer" as const, size: 8 },
      { type: "hero" as const, heading: "Welcome" },
    ];

    test("a union item previews as the variant the value takes", () => {
      const res = blocks["executePreview"]("/test.val.ts" as SourcePath, src);
      const at = res["/test.val.ts" as SourcePath];
      if (at?.status !== "success" || at.data.parent !== "array") {
        throw new Error("expected an array preview");
      }
      // The spacer variant declares no preview, so its row is simply absent —
      // the consumer falls back to a generic preview for it.
      expect(at.data.items).toEqual([
        [
          0,
          {
            title: "Quote: Make it work",
            subtitle: undefined,
            image: undefined,
          },
        ],
        [2, { title: "Hero: Welcome", subtitle: undefined, image: undefined }],
      ]);
    });

    test("a union's own preview wins over its variants'", () => {
      const schema = s.array(
        s
          .union(
            "type",
            s
              .object({ type: s.literal("hero"), heading: s.string() })
              .preview(({ val }) => ({ title: `Hero: ${val.heading}` })),
            s.object({ type: s.literal("spacer"), size: s.number() }),
          )
          .preview(() => ({ title: "block" })),
      );
      const res = schema["executePreview"]("/test.val.ts" as SourcePath, [
        { type: "hero" as const, heading: "Welcome" },
      ]);
      const at = res["/test.val.ts" as SourcePath];
      if (at?.status !== "success" || at.data.parent !== "array") {
        throw new Error("expected an array preview");
      }
      expect(at.data.items).toEqual([
        [0, { title: "block", subtitle: undefined, image: undefined }],
      ]);
    });

    test("a preview nested deep within a union variant still reifies", () => {
      // The corner case: the previewing container lives inside a variant of a
      // union inside an array — the walk has to dispatch through the union to
      // reach it.
      const schema = s.array(
        s.union(
          "type",
          s.object({
            type: s.literal("gallery"),
            images: s.record(
              s
                .object({ alt: s.string() })
                .preview(({ val }) => ({ title: val.alt })),
            ),
          }),
          s.object({ type: s.literal("spacer") }),
        ),
      );
      const res = schema["executePreview"]("/test.val.ts" as SourcePath, [
        { type: "spacer" as const },
        {
          type: "gallery" as const,
          images: { a: { alt: "A cat" } },
        },
      ]);
      expect(res['/test.val.ts?p=1."images"' as SourcePath]).toStrictEqual({
        status: "success",
        data: {
          parent: "record",
          items: [
            ["a", { title: "A cat", subtitle: undefined, image: undefined }],
          ],
        },
      });
    });
  });
});
