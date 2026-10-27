import { SerializedSchema } from ".";
import { ModuleFilePath } from "../val";
import { findViewCycles, viewCycleErrors, viewTargetsOf } from "./viewCycles";

const viewOf = (moduleFilePath: string): SerializedSchema =>
  ({
    type: "view",
    opt: false,
    moduleFilePath,
  }) as SerializedSchema;

const objectOf = (items: Record<string, SerializedSchema>): SerializedSchema =>
  ({ type: "object", opt: false, items }) as SerializedSchema;

const str: SerializedSchema = {
  type: "string",
  opt: false,
  raw: false,
  options: {},
} as SerializedSchema;

const schemasOf = (
  entries: Record<string, SerializedSchema>,
): Record<ModuleFilePath, SerializedSchema> =>
  entries as Record<ModuleFilePath, SerializedSchema>;

describe("viewTargetsOf", () => {
  test("finds a view nested in an object", () => {
    expect(
      viewTargetsOf(objectOf({ title: str, shared: viewOf("/b.val.ts") })),
    ).toEqual(["/b.val.ts"]);
  });

  /**
   * The walk is generic rather than a switch over container types precisely for
   * this: a richtext carries schemas in its OPTIONS, which an enumeration of
   * containers does not descend into.
   */
  test("finds a view inside a richtext's options", () => {
    const richtext = {
      type: "richtext",
      opt: false,
      options: { a: viewOf("/link.val.ts") },
    } as unknown as SerializedSchema;
    expect(viewTargetsOf(richtext)).toEqual(["/link.val.ts"]);
  });

  test("finds views inside a discriminated union's variants", () => {
    const union = {
      type: "discriminated-union",
      opt: false,
      key: "type",
      items: [
        objectOf({ type: str, a: viewOf("/a.val.ts") }),
        objectOf({ type: str, b: viewOf("/b.val.ts") }),
      ],
    } as unknown as SerializedSchema;
    expect(viewTargetsOf(union).sort()).toEqual(["/a.val.ts", "/b.val.ts"]);
  });

  test("a schema with no views has no targets", () => {
    expect(viewTargetsOf(objectOf({ title: str }))).toEqual([]);
  });
});

describe("findViewCycles", () => {
  test("no cycle when views form a chain", () => {
    expect(
      findViewCycles(
        schemasOf({
          "/a.val.ts": objectOf({ b: viewOf("/b.val.ts") }),
          "/b.val.ts": objectOf({ c: viewOf("/c.val.ts") }),
          "/c.val.ts": objectOf({ title: str }),
        }),
      ),
    ).toEqual([]);
  });

  /**
   * A diamond is two paths to one module and is allowed: nothing reaches
   * itself, and two rows pointing at the same module is what the author wrote.
   */
  test("a diamond is not a cycle", () => {
    expect(
      findViewCycles(
        schemasOf({
          "/page.val.ts": objectOf({
            header: viewOf("/header.val.ts"),
            footer: viewOf("/footer.val.ts"),
          }),
          "/header.val.ts": objectOf({ contact: viewOf("/contact.val.ts") }),
          "/footer.val.ts": objectOf({ contact: viewOf("/contact.val.ts") }),
          "/contact.val.ts": objectOf({ email: str }),
        }),
      ),
    ).toEqual([]);
  });

  test("finds a two-module cycle once, not once per module", () => {
    const cycles = findViewCycles(
      schemasOf({
        "/a.val.ts": objectOf({ b: viewOf("/b.val.ts") }),
        "/b.val.ts": objectOf({ a: viewOf("/a.val.ts") }),
      }),
    );
    expect(cycles).toEqual([["/a.val.ts", "/b.val.ts"]]);
  });

  test("finds a self-reference", () => {
    expect(
      findViewCycles(
        schemasOf({ "/a.val.ts": objectOf({ me: viewOf("/a.val.ts") }) }),
      ),
    ).toEqual([["/a.val.ts"]]);
  });

  test("finds a three-module cycle, rotated to a stable start", () => {
    expect(
      findViewCycles(
        schemasOf({
          "/c.val.ts": objectOf({ a: viewOf("/a.val.ts") }),
          "/a.val.ts": objectOf({ b: viewOf("/b.val.ts") }),
          "/b.val.ts": objectOf({ c: viewOf("/c.val.ts") }),
        }),
      ),
    ).toEqual([["/a.val.ts", "/b.val.ts", "/c.val.ts"]]);
  });

  test("a view at a module that is not in the project is not a cycle", () => {
    expect(
      findViewCycles(
        schemasOf({ "/a.val.ts": objectOf({ b: viewOf("/gone.val.ts") }) }),
      ),
    ).toEqual([]);
  });
});

describe("viewCycleErrors", () => {
  test("reports the cycle on every module in it", () => {
    const errors = viewCycleErrors(
      schemasOf({
        "/a.val.ts": objectOf({ b: viewOf("/b.val.ts") }),
        "/b.val.ts": objectOf({ a: viewOf("/a.val.ts") }),
      }),
    );
    expect(errors).toEqual([
      {
        path: "/a.val.ts",
        message:
          "s.view() cycle: /a.val.ts -> /b.val.ts -> /a.val.ts. Views may not form a cycle.",
      },
      {
        path: "/b.val.ts",
        message:
          "s.view() cycle: /a.val.ts -> /b.val.ts -> /a.val.ts. Views may not form a cycle.",
      },
    ]);
  });

  test("a self-reference reads as one", () => {
    const errors = viewCycleErrors(
      schemasOf({ "/a.val.ts": objectOf({ me: viewOf("/a.val.ts") }) }),
    );
    expect(errors).toEqual([
      {
        path: "/a.val.ts",
        message:
          "s.view() cycle: '/a.val.ts' views itself. A view must point at another module.",
      },
    ]);
  });
});
