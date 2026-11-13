import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { collapseShownPaths, isAncestorPath } from "./shownPaths";

const { s, c } = initVal();

function Hero(props: { title: string; bullets: string[] }) {
  return props.title;
}
function Card(props: { title: string }) {
  return props.title;
}
function Columns(props: { heading: string; cards: { title: string }[] }) {
  return props.heading;
}

const hero = s
  .object({
    type: s.literal("hero"),
    title: s.string(),
    bullets: s.array(s.string()),
  })
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
    // No component anywhere in here: the rule is the same
    footer: s.object({
      text: s.string(),
      links: s.array(s.object({ label: s.string() })),
      notes: s.array(s.object({ text: s.string() })).render({ as: "inline" }),
      internal: s.string().hidden(),
    }),
    sections: s.array(s.discriminatedUnion("type", hero, columns)),
  }),
  {
    title: "Landing",
    footer: { text: "", links: [], notes: [], internal: "" },
    sections: [],
  },
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

describe("collapseShownPaths", () => {
  test("a section's fields are edited in its row", () => {
    expect(
      collapseShownPaths(
        [
          pathOf("title"),
          pathOf("sections", 0),
          pathOf("sections", 0, "title"),
          pathOf("sections", 0, "bullets"),
          pathOf("sections", 0, "bullets", 1),
        ],
        schemas(),
      ),
    ).toEqual([
      pathOf("title"),
      pathOf("sections", 0),
      // A preview row in the section's bullets list, not an editor
      pathOf("sections", 0, "bullets", 1),
    ]);
  });

  test("the outermost listed row wins", () => {
    expect(
      collapseShownPaths(
        [
          pathOf("sections", 1, "cards", 0),
          pathOf("sections", 1, "cards", 0, "title"),
        ],
        schemas(),
      ),
    ).toEqual([pathOf("sections", 1, "cards", 0)]);
  });

  test("an item of a list that is not inline keeps its own row", () => {
    // The columns row draws each card as a preview row: the card's own row is
    // where its title is edited.
    expect(
      collapseShownPaths(
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

  test("the same for objects without a component, and inline lists", () => {
    expect(
      collapseShownPaths(
        [
          pathOf("footer"),
          pathOf("footer", "text"),
          pathOf("footer", "links", 0),
          pathOf("footer", "links", 0, "label"),
          pathOf("footer", "notes", 0, "text"),
          pathOf("footer", "internal"),
        ],
        schemas(),
      ),
    ).toEqual([
      pathOf("footer"),
      // A preview row in the footer's row: listed, and its label in it
      pathOf("footer", "links", 0),
      // Hidden in the footer's row: listed
      pathOf("footer", "internal"),
    ]);
  });

  test("fields whose parent is not on the page are all there is", () => {
    const fields = [
      pathOf("sections", 0, "title"),
      pathOf("sections", 1, "cards", 0, "title"),
    ];
    expect(collapseShownPaths(fields, schemas())).toBe(fields);
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
