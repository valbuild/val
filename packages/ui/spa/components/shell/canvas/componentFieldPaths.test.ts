import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { collapseIntoComponents, isAncestorPath } from "./componentFieldPaths";

const { s, c } = initVal();

function Hero(props: { title: string }) {
  return props.title;
}
function Card(props: { title: string }) {
  return props.title;
}
function Columns(props: { heading: string; cards: { title: string }[] }) {
  return props.heading;
}

const hero = s
  .object({ type: s.literal("hero"), title: s.string() })
  .component(() => Promise.resolve({ default: Hero }));
const card = s
  .object({ title: s.string() })
  .component(() => Promise.resolve({ default: Card }));
const columns = s
  .object({
    type: s.literal("columns"),
    heading: s.string(),
    cards: s.array(card),
  })
  .component(() => Promise.resolve({ default: Columns }));

const page = c.define(
  "/landing.val.ts",
  s.object({
    title: s.string(),
    sections: s.array(s.discriminatedUnion("type", hero, columns)),
  }),
  { title: "Landing", sections: [] },
);

function pathOf(...parts: (string | number)[]): SourcePath {
  let path: SourcePath | ModuleFilePath | undefined = Internal.getValPath(page);
  for (const part of parts) {
    path =
      path === undefined ? undefined : Internal.createValPathOfItem(path, part);
  }
  if (path === undefined) throw new Error(`no path for ${parts.join(".")}`);
  return path;
}

function schemas(): Record<ModuleFilePath, SerializedSchema> {
  const schema = Internal.getSchema(page);
  if (schema === undefined) throw new Error("the module has no schema");
  return Object.fromEntries([
    [Internal.getValPath(page), schema["executeSerialize"]()],
  ]);
}

describe("collapseIntoComponents", () => {
  test("a component's fields are left out when the component is listed", () => {
    expect(
      collapseIntoComponents(
        [
          pathOf("title"),
          pathOf("sections", 0),
          pathOf("sections", 0, "title"),
          pathOf("sections", 1),
          pathOf("sections", 1, "heading"),
        ],
        schemas(),
      ),
    ).toEqual([pathOf("title"), pathOf("sections", 0), pathOf("sections", 1)]);
  });

  test("a component in a list inside a component keeps its own row", () => {
    // The columns row shows its cards as rows to open, not their fields: the
    // card's row is where its title can be typed in.
    expect(
      collapseIntoComponents(
        [
          pathOf("sections", 1),
          pathOf("sections", 1, "heading"),
          pathOf("sections", 1, "cards", 0),
          pathOf("sections", 1, "cards", 0, "title"),
        ],
        schemas(),
      ),
    ).toEqual([pathOf("sections", 1), pathOf("sections", 1, "cards", 0)]);
  });

  test("fields whose component is not on the page are all there is", () => {
    const fields = [
      pathOf("sections", 0, "title"),
      pathOf("sections", 1, "cards", 0, "title"),
    ];
    expect(collapseIntoComponents(fields, schemas())).toEqual(fields);
  });

  test("an object without a component keeps its fields", () => {
    const paths = [pathOf("title"), pathOf("sections")];
    expect(collapseIntoComponents(paths, schemas())).toBe(paths);
  });
});

describe("isAncestorPath", () => {
  test("only at a segment boundary, and never the path itself", () => {
    expect(
      isAncestorPath(pathOf("sections", 1), pathOf("sections", 1, "heading")),
    ).toBe(true);
    expect(isAncestorPath(pathOf("sections", 1), pathOf("sections", 1))).toBe(
      false,
    );
    expect(isAncestorPath(pathOf("sections", 1), pathOf("sections", 10))).toBe(
      false,
    );
    expect(isAncestorPath(pathOf(), pathOf("title"))).toBe(true);
  });
});
