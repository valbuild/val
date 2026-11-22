import { Internal, initVal } from "@valbuild/core";
import { canvasTextFields } from "./canvasTextFields";

const { c, s } = initVal();
const page = c.define(
  "/app/page.val.ts",
  s.object({
    title: s.string(),
    subtitle: s.string(),
    blank: s.string(),
    slug: s.string().readonly(),
    caption: s.string().nullable(),
    year: s.number(),
    body: s.richtext({ bold: true }),
    notes: s.richtext({ img: true }),
    emptied: s.richtext({ bold: true }),
  }),
  {
    title: "Our people",
    subtitle: "",
    blank: "  ",
    slug: "",
    caption: null,
    year: 2012,
    body: [{ tag: "p", children: ["We are forty."] }],
    notes: [
      {
        tag: "p",
        children: [{ tag: "img", src: { path: "/public/val/a.png" } }],
      },
    ],
    emptied: [{ tag: "p", children: [""] }],
  },
);

const root = Internal.getValPath(page);
if (root === undefined) throw new Error("the module has no path");
const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(root);
const schema = Internal.getSchema(page)?.["executeSerialize"]();
const path = (field: string) =>
  Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath([field]),
  );
const ALL = [
  "title",
  "subtitle",
  "blank",
  "slug",
  "caption",
  "year",
  "body",
  "notes",
  "emptied",
].map(path);

function fields(editing: boolean) {
  if (schema === undefined) throw new Error("the module has no schema");
  return canvasTextFields(
    ALL,
    { [moduleFilePath]: Internal.getSource(page) },
    { [moduleFilePath]: schema },
    editing,
  );
}

describe("what the page is told of its texts ahead of a click", () => {
  it("names the strings and richtexts that are empty, in either mode", () => {
    const expected = [
      path("subtitle"),
      path("blank"),
      // Read-only, and still pointable: a pick opens it in the column.
      path("slug"),
      path("emptied"),
    ];
    expect(fields(false).empty).toEqual(expected);
    expect(fields(true).empty).toEqual(expected);
  });

  it("does not call null, a number or a document with only an image empty", () => {
    const { empty } = fields(true);
    expect(empty).not.toContain(path("caption"));
    expect(empty).not.toContain(path("year"));
    expect(empty).not.toContain(path("notes"));
  });

  it("offers what can be typed in, with its value, only in Select & edit", () => {
    expect(fields(false)).toMatchObject({ editing: false, editable: [] });
    const { editing, editable } = fields(true);
    expect(editing).toBe(true);
    expect(editable).toContainEqual({
      path: path("title"),
      kind: "string",
      value: "Our people",
    });
    // An emptied text can be typed back in, and is offered too.
    expect(editable).toContainEqual({
      path: path("subtitle"),
      kind: "string",
      value: "",
    });
    // What `editInline` would not offer, this does not either.
    const offered = editable.map((candidate) => candidate.path);
    expect(offered).not.toContain(path("slug"));
    expect(offered).not.toContain(path("year"));
  });
});
