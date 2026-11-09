import { initVal } from "@valbuild/core";
import { blockTypesOfSchemas } from "./sketchBlockTypes";

const { s } = initVal();

const hero = s
  .object({ type: s.literal("hero"), title: s.string() })
  .describe("A big title over a picture");
const pricing = s.object({
  type: s.literal("pricing-table"),
  plans: s.number(),
});
const link = s.discriminatedUnion(
  "kind",
  s.object({ kind: s.literal("internal"), to: s.string() }),
  s.object({ kind: s.literal("external"), href: s.string() }),
);

describe("blockTypesOfSchemas", () => {
  test("the variants of a page's list of sections, and nothing else", () => {
    const schemas = {
      // As the Studio is handed it: the wire form, with a page router on it.
      "/app/[slug]/page.val.ts": {
        ...s
          .record(
            s.object({
              title: s.string(),
              cta: link,
              sections: s.array(s.discriminatedUnion("type", hero, pricing)),
            }),
          )
          ["executeSerialize"](),
        router: "next-app-router",
      },
      // Not a page: its unions are not a page's sections.
      "/data/blocks.val.ts": s
        .array(
          s.discriminatedUnion(
            "type",
            s.object({ type: s.literal("footer-only"), x: s.string() }),
          ),
        )
        ["executeSerialize"](),
    };
    expect(blockTypesOfSchemas(schemas)).toEqual([
      { kind: "hero", description: "A big title over a picture" },
      { kind: "pricing-table" },
    ]);
  });
});
