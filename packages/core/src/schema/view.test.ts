import { Schema, SchemaAssertResult } from ".";
import { initVal } from "../initVal";
import { getSource } from "../module";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";

const { s, c } = initVal();

const headerVal = c.define(
  "/settings/header.val.ts",
  s.object({ title: s.string() }),
  { title: "Blank" },
);

const employeesVal = c.define(
  "/data/employees.val.ts",
  s.record(s.object({ name: s.string() })),
  { lee: { name: "Lee" } },
);

const pageSchema = s.object({
  header: s.view(headerVal).describe("The site header, shown for context"),
  title: s.string(),
  employees: s.view(employeesVal).editable(),
});

// THE CALL SITE: no `header`, no `employees`.
const pageVal = c.define("/page.val.ts", pageSchema, {
  title: "Våre folk",
});

describe("s.view()", () => {
  test("serializes without carrying the target's schema", () => {
    const serialized = (pageSchema as Schema<SelectorSource>)[
      "executeSerialize"
    ]();
    expect(serialized).toEqual({
      type: "object",
      items: {
        header: {
          type: "view",
          render: undefined,
          moduleFilePath: "/settings/header.val.ts",
          editable: false,
          opt: false,
          readonly: false,
          hidden: false,
          description: "The site header, shown for context",
        },
        title: expect.objectContaining({ type: "string" }),
        employees: expect.objectContaining({
          type: "view",
          moduleFilePath: "/data/employees.val.ts",
          editable: true,
        }),
      },
      opt: false,
      customValidate: false,
      readonly: false,
      hidden: false,
      description: undefined,
      render: undefined,
      preview: undefined,
    });
  });

  test("validate ignores the view keys", () => {
    const res = (pageSchema as Schema<SelectorSource>)["executeValidate"](
      "/page.val.ts" as SourcePath,
      { title: "Våre folk" },
    );
    expect(res).toEqual(false);
  });

  test("the source is what was written", () => {
    expect(getSource(pageVal)).toEqual({ title: "Våre folk" });
  });

  /**
   * `executeAssert` reports every declared key the source does not have. A view
   * key is absent BY DESIGN, so reporting it made `restoreValidity` (and every
   * other assert caller) see a type error on a module that is entirely correct.
   */
  test("assert does not demand the view keys", () => {
    const res: SchemaAssertResult<SelectorSource> = (
      pageSchema as Schema<SelectorSource>
    )["executeAssert"]("/page.val.ts" as SourcePath, { title: "Våre folk" });
    expect(res).toEqual({ success: true, data: { title: "Våre folk" } });
  });

  test("assert still reports an ordinary missing key", () => {
    const res: SchemaAssertResult<SelectorSource> = (
      pageSchema as Schema<SelectorSource>
    )["executeAssert"]("/page.val.ts" as SourcePath, {});
    expect(res).toEqual({
      success: false,
      errors: {
        "/page.val.ts": [
          {
            message: "Expected key 'title' not found in object",
            typeError: true,
          },
        ],
      },
    });
  });

  /**
   * A view stores nothing, so a module whose whole schema is a view has no
   * source at all — which type-checks (`undefined` is a `SelectorSource`) and
   * then fails everywhere downstream that expects a module to have source.
   */
  test("a module cannot BE a view", () => {
    expect(() =>
      c.define("/root.val.ts", s.view(headerVal), undefined),
    ).toThrow(/cannot be a module's own schema/);
  });

  test("nullable is refused", () => {
    expect(() => s.view(headerVal).nullable()).toThrow(/cannot be nullable/);
  });
});
