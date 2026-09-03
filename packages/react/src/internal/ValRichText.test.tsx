/** @jest-environment jsdom */
import { initVal, StringSchema } from "@valbuild/core";
import { render, screen } from "@testing-library/react";
import { ThemeOptions, ValRichText } from "./ValRichText";
import { stegaEncode } from "../stega/stegaEncode";

const { s, c } = initVal();

/**
 * A theme has to name every tag and style the schema turned on - that is the
 * whole point of typing it against the options - so these assertions are the
 * ones that break if `ThemeOptions` ever goes back to being permissive.
 */
type Assert<T extends true> = T;
type IsKey<K extends string, O> = K extends keyof O ? true : false;
type IsRequired<K extends keyof O, O> = undefined extends O[K] ? false : true;

type _EnabledOptionIsARequiredThemeKey = Assert<
  IsRequired<"italic", ThemeOptions<{ bold: true; italic: true }>>
>;
type _DisabledOptionIsNotAThemeKey = Assert<
  IsKey<"italic", ThemeOptions<{ bold: true }>> extends false ? true : false
>;
type _ListsBringLiWithThem = Assert<
  IsRequired<"li", ThemeOptions<{ ol: true }>>
>;
type _NoListMeansNoLi = Assert<
  IsKey<"li", ThemeOptions<{ bold: true }>> extends false ? true : false
>;
/** `a` is on when it carries a schema, not only when it is literally `true`. */
type _SchemaBackedAnchorIsARequiredThemeKey = Assert<
  IsRequired<"a", ThemeOptions<{ a: StringSchema<string> }>>
>;
/** Tags no option controls are always optional. */
type _AlwaysOnTagsStayOptional = Assert<
  IsRequired<"p", ThemeOptions<{ bold: true }>> extends false ? true : false
>;

describe("ValRichText", () => {
  test("theme class names are applied per tag and per style", () => {
    const schema = s.richtext({
      bold: true,
      italic: true,
      h1: true,
      ul: true,
    });
    const valModule = c.define("/richtext.val.ts", s.object({ text: schema }), {
      text: [
        { tag: "h1", children: ["Heading"] },
        {
          tag: "p",
          children: [{ tag: "span", styles: ["bold"], children: ["Bold"] }],
        },
        {
          tag: "ul",
          children: [
            { tag: "li", children: [{ tag: "p", children: ["Item"] }] },
          ],
        },
      ],
    });
    const content = stegaEncode(valModule, {}).text;

    render(
      // `stegaEncode` is untyped, so the options are named here rather than
      // inferred from the content - the inference path is covered by the app in
      // `examples/next`, which typechecks its themes against real content.
      <ValRichText<{ bold: true; italic: true; h1: true; ul: true }>
        content={content}
        theme={{
          h1: "heading",
          bold: "font-bold",
          italic: "font-italic",
          ul: "list",
          li: "item",
        }}
      />,
    );

    expect(screen.getByText("Heading").className).toBe("heading");
    expect(screen.getByText("Bold").className).toBe("font-bold");
    expect(screen.getByText("Item").closest("li")?.className).toBe("item");
  });
});
