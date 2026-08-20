import { initVal, SvgSource, SVG_VAL_PATH } from "@valbuild/core";
import { renderToStaticMarkup } from "react-dom/server";
import { SvgVars, ValSvg } from "./ValSvg";

const { s } = initVal();

const iconSchema = s.svg({
  variables: { brand: "#0055ff", line: "currentColor" },
});
type IconOptions = { variables: { brand: string; line: string } };

const icon: SvgSource<IconOptions> = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  children: [
    {
      tag: "path",
      attrs: { d: "M4 12h16", fill: { var: "brand" } },
      children: [],
    },
    {
      tag: "circle",
      attrs: {
        cx: 12,
        cy: 12,
        r: 4,
        stroke: { var: "line" },
        fill: "none",
      },
      children: [],
    },
  ],
};

// Type level: `vars` must cover every variable the schema declares, so adding
// one to the schema is a compile error at the call site. Same contract as
// ValRichText's `theme`.
type Assert<T extends true> = T;
type IsRequired<T, K extends keyof T> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {} extends Pick<T, K> ? false : true;
type _BrandIsRequired = Assert<IsRequired<SvgVars<IconOptions>, "brand">>;
type _LineIsRequired = Assert<IsRequired<SvgVars<IconOptions>, "line">>;

describe("ValSvg", () => {
  test("resolves variables from vars", () => {
    const html = renderToStaticMarkup(
      <ValSvg<IconOptions>
        src={icon}
        vars={{ brand: "var(--brand-500)", line: "currentColor" }}
      />,
    );
    expect(html).toContain('fill="var(--brand-500)"');
    expect(html).toContain('stroke="currentColor"');
    // a non variable color is emitted as written
    expect(html).toContain('fill="none"');
  });

  test("falls back to a css custom property when a var is null", () => {
    const html = renderToStaticMarkup(
      <ValSvg<IconOptions> src={icon} vars={{ brand: null, line: "red" }} />,
    );
    expect(html).toContain('fill="var(--val-svg-brand, currentColor)"');
    expect(html).toContain('stroke="red"');
  });

  test("resolves every variable from css when vars is omitted", () => {
    const html = renderToStaticMarkup(<ValSvg src={icon} />);
    expect(html).toContain('fill="var(--val-svg-brand, currentColor)"');
    expect(html).toContain('stroke="var(--val-svg-line, currentColor)"');
  });

  describe("sizing", () => {
    test("size sets both", () => {
      const html = renderToStaticMarkup(<ValSvg src={icon} size={32} />);
      expect(html).toContain('width="32"');
      expect(html).toContain('height="32"');
    });

    test("an explicit width or height wins over size", () => {
      const html = renderToStaticMarkup(
        <ValSvg src={icon} size={32} height={16} />,
      );
      expect(html).toContain('width="32"');
      expect(html).toContain('height="16"');
    });

    test("falls back to the intrinsic size on the source", () => {
      const html = renderToStaticMarkup(<ValSvg src={icon} />);
      expect(html).toContain('width="24"');
      expect(html).toContain('height="24"');
    });

    test("always emits the viewBox", () => {
      expect(renderToStaticMarkup(<ValSvg src={icon} size={8} />)).toContain(
        'viewBox="0 0 24 24"',
      );
    });
  });

  describe("accessibility", () => {
    test("a title makes it an image with an accessible name", () => {
      const html = renderToStaticMarkup(
        <ValSvg src={icon} title="Notifications" />,
      );
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label="Notifications"');
      expect(html).toContain("<title>Notifications</title>");
      expect(html).not.toContain("aria-hidden");
    });

    test("without a title it is decorative", () => {
      const html = renderToStaticMarkup(<ValSvg src={icon} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('role="presentation"');
      expect(html).not.toContain("<title>");
    });
  });

  test("emits data-val-path from the field stega attaches", () => {
    const html = renderToStaticMarkup(
      <ValSvg src={{ ...icon, [SVG_VAL_PATH]: '/icons.val.ts?p="bell"' }} />,
    );
    expect(html).toContain('data-val-path="/icons.val.ts?p=&quot;bell&quot;"');
  });

  test("omits data-val-path when stega did not run", () => {
    expect(renderToStaticMarkup(<ValSvg src={icon} />)).not.toContain(
      "data-val-path",
    );
  });

  test("renders nothing for a missing source", () => {
    expect(
      renderToStaticMarkup(
        <ValSvg src={null as unknown as SvgSource<IconOptions>} />,
      ),
    ).toBe("");
  });

  test("the schema and the component agree on the variable names", () => {
    const serialized = iconSchema["executeSerialize"]();
    const names =
      serialized.type === "svg"
        ? Object.keys(serialized.options?.variables ?? {})
        : [];
    const vars: SvgVars<IconOptions> = {
      brand: "#0055ff",
      line: "currentColor",
    };
    expect(names.sort()).toStrictEqual(Object.keys(vars).sort());
  });
});

// Keep the unused type aliases referenced so lint does not drop them.
export type _TypeChecks = [_BrandIsRequired, _LineIsRequired];
