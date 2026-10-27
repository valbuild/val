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
  employees: s.view(employeesVal),
});

const pageVal = c.define("/page.val.ts", pageSchema, {
  header: { view: "/settings/header.val.ts" },
  title: "Våre folk",
  employees: { view: "/data/employees.val.ts" },
});

describe("s.view()", () => {
  test("serializes as a pointer, carrying nothing of the target", () => {
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
          opt: false,
          readonly: false,
          hidden: false,
          description: "The site header, shown for context",
        },
        title: expect.objectContaining({ type: "string" }),
        employees: expect.objectContaining({
          type: "view",
          moduleFilePath: "/data/employees.val.ts",
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

  test("the source is the pointer that was written", () => {
    expect(getSource(pageVal)).toEqual({
      header: { view: "/settings/header.val.ts" },
      title: "Våre folk",
      employees: { view: "/data/employees.val.ts" },
    });
  });

  test("a pointer that matches its schema validates", () => {
    const res = (pageSchema as Schema<SelectorSource>)["executeValidate"](
      "/page.val.ts" as SourcePath,
      {
        header: { view: "/settings/header.val.ts" },
        title: "Våre folk",
        employees: { view: "/data/employees.val.ts" },
      },
    );
    expect(res).toEqual(false);
  });

  /**
   * Unreachable from a `.val.ts` — the source type is the literal path, so a
   * mismatch does not compile. Reachable from hand-written JSON, which is what
   * this check is for.
   */
  test("a pointer that names another module is a validation error", () => {
    const res = (pageSchema as Schema<SelectorSource>)["executeValidate"](
      "/page.val.ts" as SourcePath,
      {
        header: { view: "/settings/footer.val.ts" },
        title: "Våre folk",
        employees: { view: "/data/employees.val.ts" },
      },
    );
    expect(res).toEqual({
      '/page.val.ts?p="header"': [
        {
          message:
            "This view points at '/settings/footer.val.ts', but its schema says '/settings/header.val.ts'",
          value: { view: "/settings/footer.val.ts" },
          // There is exactly one valid value and the schema knows it, so the
          // error carries the fix that writes it.
          fixes: ["view:check-module"],
        },
      ],
    });
  });

  test("a value that is not a pointer at all is a validation error", () => {
    const res = (pageSchema as Schema<SelectorSource>)["executeValidate"](
      "/page.val.ts" as SourcePath,
      {
        header: "nope",
        title: "Våre folk",
        employees: { view: "/data/employees.val.ts" },
      },
    );
    expect(res).toMatchObject({
      '/page.val.ts?p="header"': [
        { message: expect.stringContaining("Expected a view pointer") },
      ],
    });
  });

  test("assert accepts a pointer and rejects anything else", () => {
    const schema = s.view(headerVal) as Schema<SelectorSource>;
    const ok: SchemaAssertResult<SelectorSource> = schema["executeAssert"](
      "/page.val.ts" as SourcePath,
      { view: "/settings/header.val.ts" },
    );
    expect(ok).toEqual({
      success: true,
      data: { view: "/settings/header.val.ts" },
    });
    const bad: SchemaAssertResult<SelectorSource> = schema["executeAssert"](
      "/page.val.ts" as SourcePath,
      42,
    );
    expect(bad.success).toBe(false);
  });

  /**
   * A view points at a module, so a module that is only a view has no content
   * of its own and one redundant level of indirection. A view is a field.
   */
  test("a module cannot BE a view", () => {
    expect(() =>
      c.define("/root.val.ts", s.view(headerVal), {
        view: "/settings/header.val.ts",
      }),
    ).toThrow(/cannot be a module's own schema/);
  });

  test("nullable is refused", () => {
    expect(() => s.view(headerVal).nullable()).toThrow(/cannot be nullable/);
  });
});
