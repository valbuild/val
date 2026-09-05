/** @jest-environment jsdom */
import { initVal, type SourcePath } from "@valbuild/core";
import { render, screen } from "@testing-library/react";
import { LocaleFilterProvider, LocaleFiltered } from "./LocaleFilterProvider";

const { s } = initVal();

const PROJECT_LOCALES = ["en-US", "nb-NO"];

const scoped = s
  .object({ locale: s.locale(), title: s.string() })
  ["executeSerialize"]();
const aliased = s
  .object({
    locale: s.locale().aliases({ "nb-NO": "no" }),
    title: s.string(),
  })
  ["executeSerialize"]();
const plain = s.object({ title: s.string() })["executeSerialize"]();
const blocks = s
  .union(
    "type",
    s.object({
      type: s.literal("quote"),
      locale: s.locale(),
      text: s.string(),
    }),
    s.object({ type: s.literal("image"), alt: s.string() }),
  )
  ["executeSerialize"]();

/**
 * What the row is: its schema, the value of its locale field, and — where the
 * row is a block — the tag saying which branch of the union it takes.
 *
 * Keyed by path so one mock serves every row a test renders — the component
 * reads the schema at its own path and both fields one level under it.
 */
const rows: Record<
  string,
  { schema: unknown; locale?: string | null; tag?: string }
> = {};

jest.mock("../hooks/useProjectLocales", () => ({
  __esModule: true,
  useProjectLocales: () => PROJECT_LOCALES,
}));

jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useSchemaAtPath: (path: string) =>
    rows[path] === undefined
      ? { status: "not-found" }
      : { status: "success", data: rows[path].schema },
  useShallowSourceAtPath: (path: string) => {
    // A field's own path: `<row>."locale"` for a row at `<row>`. The empty path
    // the component passes for a lookup it does not need matches no row, which
    // is how it resolves to nothing.
    const row = Object.keys(rows).find((each) => path.startsWith(each));
    if (row === undefined) {
      return { status: "not-found" };
    }
    const value = path.endsWith('."type"') ? rows[row].tag : rows[row].locale;
    if (value === undefined) {
      return { status: "not-found" };
    }
    return { status: "success", data: value };
  },
}));

function renderRow(path: string, filter: string | null) {
  return render(
    <LocaleFilterProvider locale={filter}>
      <LocaleFiltered path={path as SourcePath}>
        <div data-testid="row">{path}</div>
      </LocaleFiltered>
    </LocaleFilterProvider>,
  );
}

/**
 * A row hides itself when the filter says another language.
 *
 * The read has to happen HERE rather than in the list: a list has paths, and the
 * language is in the row's content. That is a hook, and a hook cannot be called
 * from inside a `.map()`.
 */
describe("a row under the locale filter", () => {
  beforeEach(() => {
    for (const key of Object.keys(rows)) delete rows[key];
  });

  test("with no filter, the row is drawn", () => {
    rows["/c.val.ts?p=0"] = { schema: scoped, locale: "en-US" };
    renderRow("/c.val.ts?p=0", null);
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("a row in the selected language is drawn", () => {
    rows["/c.val.ts?p=0"] = { schema: scoped, locale: "nb-NO" };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("a row in another language is not", () => {
    rows["/c.val.ts?p=0"] = { schema: scoped, locale: "en-US" };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.queryByTestId("row")).toBeNull();
  });

  test("a row with no locale field is always drawn", () => {
    rows["/c.val.ts?p=0"] = { schema: plain };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("aliases resolve, so a stored 'no' is Norwegian", () => {
    rows["/c.val.ts?p=0"] = { schema: aliased, locale: "no" };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("a locale field nobody has filled in stays drawn", () => {
    // Hiding it would hide the field someone has to fill in to un-hide it.
    rows["/c.val.ts?p=0"] = { schema: scoped, locale: null };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("a row whose content has not loaded yet stays drawn", () => {
    // A row that vanishes as its content arrives is the other bad outcome.
    rows["/c.val.ts?p=0"] = { schema: scoped };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("a block row reads the locale field on the BRANCH it takes", () => {
    // The row's schema is the union, and a union has no fields of its own. A
    // filter that stopped there would be a no-op on the block lists it was
    // written for.
    rows["/c.val.ts?p=0"] = { schema: blocks, tag: "quote", locale: "en-US" };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.queryByTestId("row")).toBeNull();
    rows["/c.val.ts?p=0"] = { schema: blocks, tag: "quote", locale: "nb-NO" };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("a block whose branch has no locale field is always drawn", () => {
    rows["/c.val.ts?p=0"] = { schema: blocks, tag: "image" };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });

  test("a block whose tag has not loaded stays drawn", () => {
    // No branch yet, so no locale field to read — and a row that vanishes as
    // its content arrives is the mistake this avoids.
    rows["/c.val.ts?p=0"] = { schema: blocks, locale: "en-US" };
    renderRow("/c.val.ts?p=0", "nb-NO");
    expect(screen.getByTestId("row")).toBeDefined();
  });
});
