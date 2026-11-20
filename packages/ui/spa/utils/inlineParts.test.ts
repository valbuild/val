import { initVal } from "@valbuild/core";
import { inlineParts } from "./inlineParts";

const { s } = initVal();

describe("inlineParts", () => {
  test("walks nested objects in schema order, labelling each value by its own field", () => {
    const schema = s
      .object({
        person: s.object({
          name: s.string(),
          contact: s.object({ email: s.string(), phone: s.string() }),
        }),
        role: s.string(),
      })
      ["executeSerialize"]();
    expect(
      inlineParts(
        schema,
        {
          person: {
            name: "Fredrik",
            contact: { email: "fredrik@example.com", phone: "" },
          },
          role: "Developer",
        },
        null,
      ),
    ).toEqual([
      { label: "Name", text: "Fredrik" },
      { label: "Email", text: "fredrik@example.com" },
      { label: "Role", text: "Developer" },
    ]);
  });

  test("leaves out empty values, hidden fields and empty lists", () => {
    const schema = s
      .object({
        title: s.string(),
        secret: s.string().hidden(),
        subtitle: s.string().nullable(),
        tags: s.array(s.string()),
        nested: s.object({ inner: s.string() }).nullable(),
      })
      ["executeSerialize"]();
    expect(
      inlineParts(
        schema,
        { title: "", secret: "x", subtitle: null, tags: [], nested: null },
        null,
      ),
    ).toEqual([]);
  });

  test("shows a list as a count, a boolean as Yes / No, and media by file name", () => {
    const schema = s
      .object({
        tags: s.array(s.string()),
        published: s.boolean(),
        image: s.image(),
      })
      ["executeSerialize"]();
    expect(
      inlineParts(
        schema,
        {
          tags: ["a", "b"],
          published: false,
          image: { path: "/public/val/logo_a1b2c.png" },
        },
        null,
      ),
    ).toEqual([
      { label: "Tags", text: "2 items" },
      { label: "Published", text: "No" },
      { label: "Image", text: "logo_a1b2c.png" },
    ]);
  });

  test("descends into the variant a discriminated union's value has", () => {
    const schema = s
      .discriminatedUnion(
        "type",
        s.object({ type: s.literal("link"), href: s.string() }),
        s.object({ type: s.literal("text"), body: s.string() }),
      )
      ["executeSerialize"]();
    expect(inlineParts(schema, { type: "text", body: "Hello" }, null)).toEqual([
      { label: "Type", text: "text" },
      { label: "Body", text: "Hello" },
    ]);
  });
});
