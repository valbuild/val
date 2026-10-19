import { initVal, modules, type ModuleFilePath } from "@valbuild/core";
import { readValModules } from "./readValModules";

const { s, c, config } = initVal();

/*
 * A bundled `val.modules.ts`, imported: `modules(config, [...])` as its
 * default export. Here made with this copy of core; in the tab, with the
 * site's (see `bundleValModules`).
 */
const HOME = "/home.val.ts" as ModuleFilePath;
const NOTES = "/notes.val.ts" as ModuleFilePath;
const home = c.define(
  HOME,
  s.object({
    title: s
      .string()
      .validate((title) => (title.includes("sale") ? "No sales" : false)),
  }),
  { title: "Hello" },
);
const notes = c.define(
  NOTES,
  s.record(s.object({ text: s.string() })).jsonValues(),
  { a: c.json(async () => ({ default: { text: "First" } })) },
);
const entry = {
  default: modules(config, [
    { def: async () => ({ default: home }) },
    { def: async () => ({ default: notes }) },
  ]),
};

describe("readValModules", () => {
  test("each module's schema, and the content its text holds, its .val.json entries read", async () => {
    const evaluated = await readValModules(entry, () => null);
    expect(evaluated[HOME]).toEqual({
      schema: expect.objectContaining({ type: "object" }),
      written: { title: "Hello" },
      errors: [],
    });
    expect(evaluated[NOTES]?.written).toEqual({ a: { text: "First" } });
    expect(evaluated[NOTES]?.schema).toMatchObject({
      type: "record",
      jsonValues: true,
    });
  });

  test("the errors are of the Source asked about, under the module's own rules", async () => {
    const evaluated = await readValModules(entry, (path) =>
      path === HOME ? { title: "Big sale" } : null,
    );
    expect(evaluated[HOME]?.errors).toEqual([
      { path: ["title"], message: "No sales" },
    ]);
  });

  test("something that is not modules(config, [...]) says so", async () => {
    await expect(readValModules({ default: {} }, () => null)).rejects.toThrow(
      /modules\(config/,
    );
    await expect(
      readValModules(
        { default: { modules: [{ def: async () => ({ default: 1 }) }] } },
        () => null,
      ),
    ).rejects.toThrow(/c\.define/);
  });
});
