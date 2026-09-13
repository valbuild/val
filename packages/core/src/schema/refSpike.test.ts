import { initVal } from "../initVal";
import { getSource } from "../module";

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
  header: s.ref(headerVal).describe("The site header, shown for context"),
  title: s.string(),
  employees: s.ref(employeesVal).editable(),
});

// THE CALL SITE: no `header`, no `employees`.
const pageVal = c.define("/page.val.ts", pageSchema, {
  title: "Våre folk",
});

describe("ref spike", () => {
  test("serializes without carrying the target's schema", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serialized = (pageSchema as any)["executeSerialize"]();
    expect(serialized).toEqual({
      type: "object",
      items: {
        header: {
          type: "ref",
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
          type: "ref",
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

  test("validate ignores the ref keys", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (pageSchema as any)["executeValidate"]("/page.val.ts", {
      title: "Våre folk",
    });
    expect(res).toEqual(false);
  });

  test("the source is what was written", () => {
    expect(getSource(pageVal)).toEqual({ title: "Våre folk" });
  });
});
