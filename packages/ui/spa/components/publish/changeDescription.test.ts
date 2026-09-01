import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  describeValue,
  renderChangeDescription,
  type FieldChange,
} from "./changeDescription";

function change(overrides: Partial<FieldChange>): FieldChange {
  return {
    sourcePath: '/content/home.val.ts?p="hero"."title"' as SourcePath,
    moduleFilePath: "/content/home.val.ts" as ModuleFilePath,
    fieldPath: 'hero."title"',
    schemaType: "string",
    before: "Old",
    after: "New",
    ...overrides,
  };
}

describe("describeValue", () => {
  test("tells 'not set' apart from 'empty'", () => {
    expect(describeValue(undefined)).toBe("(not set)");
    expect(describeValue(null)).toBe("(empty)");
  });

  test("collapses whitespace so a prompt stays one line per value", () => {
    expect(describeValue("a\n\n  b\tc")).toBe("a b c");
  });

  test("truncates a long string and says how long it was", () => {
    const value = "x".repeat(500);
    const described = describeValue(value);
    expect(described.length).toBeLessThan(300);
    expect(described).toContain("500 characters in total");
  });

  test("describes media by its path, not its bytes", () => {
    expect(
      describeValue({
        path: "/public/val/hero_a1b2c.jpg",
        width: 1200,
        height: 800,
        mimeType: "image/jpeg",
      }),
    ).toBe("(file /public/val/hero_a1b2c.jpg)");
  });

  test("never inlines a data url", () => {
    const described = describeValue({
      path: "data:image/png;base64," + "A".repeat(5000),
    });
    expect(described.length).toBeLessThan(120);
  });

  test("counts a list rather than dumping it", () => {
    expect(describeValue([1, 2, 3])).toBe("(list of 3)");
  });

  test("names an object's fields rather than dumping it", () => {
    expect(describeValue({ title: "a", body: "b" })).toBe(
      "(fields: title, body)",
    );
  });
});

describe("renderChangeDescription", () => {
  test("says so when there is nothing", () => {
    expect(renderChangeDescription([])).toBe("No changes.");
  });

  test("groups by module, under a name a reader recognises", () => {
    const rendered = renderChangeDescription([
      change({}),
      change({
        moduleFilePath: "/content/blogs/page.val.ts" as ModuleFilePath,
        fieldPath: '"post-1"."title"',
      }),
    ]);
    expect(rendered).toContain("## Home");
    expect(rendered).toContain("## Blogs");
    expect(rendered).toContain("before: Old");
    expect(rendered).toContain("after:  New");
  });

  test("labels a module-root change rather than showing an empty field", () => {
    expect(renderChangeDescription([change({ fieldPath: "" })])).toContain(
      "(the whole entry)",
    );
  });

  test("caps the list and counts the rest, so a big publish stays small", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      change({ fieldPath: `field${i}` }),
    );
    const rendered = renderChangeDescription(many);
    expect(rendered).toContain("(20 further changes not listed)");
    expect(rendered).not.toContain("field59");
  });

  test("uses the singular for exactly one omitted change", () => {
    const many = Array.from({ length: 41 }, (_, i) =>
      change({ fieldPath: `field${i}` }),
    );
    expect(renderChangeDescription(many)).toContain(
      "(1 further change not listed)",
    );
  });
});
