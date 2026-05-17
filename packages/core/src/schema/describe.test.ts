import { array } from "./array";
import { boolean } from "./boolean";
import { date } from "./date";
import { literal } from "./literal";
import { number } from "./number";
import { object } from "./object";
import { record } from "./record";
import { richtext } from "./richtext";
import { route } from "./route";
import { string } from "./string";

describe("Schema.describe()", () => {
  test("string: describe is serialized", () => {
    const schema = string().describe("Authors name");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Authors name",
    });
  });

  test("number: describe is serialized", () => {
    const schema = number().describe("Age");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "number",
      description: "Age",
    });
  });

  test("boolean: describe is serialized", () => {
    const schema = boolean().describe("Is published");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "boolean",
      description: "Is published",
    });
  });

  test("date: describe is serialized", () => {
    const schema = date().describe("Birthday");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "date",
      description: "Birthday",
    });
  });

  test("literal: describe is serialized", () => {
    const schema = literal("admin").describe("Access tier");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "literal",
      description: "Access tier",
    });
  });

  test("route: describe is serialized", () => {
    const schema = route().describe("Page route");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "route",
      description: "Page route",
    });
  });

  test("richtext: describe is serialized", () => {
    const schema = richtext({}).describe("Body copy");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "richtext",
      description: "Body copy",
    });
  });

  test("object: describe is serialized on the object schema itself", () => {
    const schema = object({
      name: string().describe("Authors name"),
    }).describe("Author of blog");
    const serialized = schema["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "object",
      description: "Author of blog",
    });
    expect(
      (serialized as { items: Record<string, unknown> }).items.name,
    ).toMatchObject({
      type: "string",
      description: "Authors name",
    });
  });

  test("array: describe is serialized; item description survives", () => {
    const schema = array(string().describe("Tag")).describe("Tags");
    const serialized = schema["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "array",
      description: "Tags",
    });
    expect(serialized.item).toMatchObject({
      type: "string",
      description: "Tag",
    });
  });

  test("record: describe is serialized on both key and value schemas", () => {
    const schema = record(
      string().describe("Email"),
      object({ name: string().describe("Authors name") }).describe("Author"),
    );
    const serialized = schema["executeSerialize"]();
    expect(serialized.type).toBe("record");
    expect(serialized.key).toMatchObject({
      type: "string",
      description: "Email",
    });
    expect(serialized.item).toMatchObject({
      type: "object",
      description: "Author",
    });
  });

  test("describe survives after .nullable()", () => {
    const schema = string().describe("X").nullable();
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "X",
      opt: true,
    });
  });

  test("describe survives after .minLength() / .maxLength() / .regexp() on string", () => {
    const schema = string()
      .describe("Slug")
      .minLength(1)
      .maxLength(10)
      .regexp(/^[a-z]+$/);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Slug",
    });
  });

  test("describe can be added at the end of a chain", () => {
    const schema = string().minLength(1).maxLength(10).describe("Slug");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Slug",
    });
  });

  test("describe survives after .min() / .max() on number", () => {
    const schema = number().describe("Score").min(0).max(100);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "number",
      description: "Score",
    });
  });

  test("describe survives after .from() / .to() on date", () => {
    const schema = date()
      .describe("Event date")
      .from("2020-01-01")
      .to("2030-12-31");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "date",
      description: "Event date",
    });
  });

  test("describe survives after .raw() on string", () => {
    const schema = string().describe("Code").raw();
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Code",
      raw: true,
    });
  });

  test("describe survives after .validate() on object", () => {
    const schema = object({ name: string() })
      .describe("Author")
      .validate(() => false);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "object",
      description: "Author",
    });
  });

  test("schemas without describe serialize description as undefined", () => {
    const schema = string();
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: undefined,
    });
  });

  test("later describe call replaces earlier one", () => {
    const schema = string().describe("first").describe("second");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "second",
    });
  });

  test("describe(null) clears a previously set description", () => {
    const schema = string().describe("hello").describe(null);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: undefined,
    });
  });

  test("describe(null) on a schema with no description is a no-op", () => {
    const schema = number().describe(null);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "number",
      description: undefined,
    });
  });

  test("describe(null) on record clears description on item and key independently", () => {
    const schema = record(
      string().describe("Email"),
      object({}).describe("Author").describe(null),
    );
    const serialized = schema["executeSerialize"]();
    expect(serialized.key).toMatchObject({
      type: "string",
      description: "Email",
    });
    expect(serialized.item).toMatchObject({
      type: "object",
      description: undefined,
    });
  });
});
