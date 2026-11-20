import type { ModuleFilePath } from "@valbuild/core";
import type { ContentSource, EntryRead } from "@valbuild/shared/internal";
import { layered } from "./layered";
import { codeChangedReporter } from "./codeChanged";

const PATH = "/notes.val.ts" as ModuleFilePath;
const version = (schema: string) => ({
  schema,
  base: "b",
  chain: "",
  key: "a",
});

function answering(name: string, read: EntryRead): ContentSource {
  return {
    name,
    module: () => ({ status: "pass" }),
    entry: () => read,
  };
}

/**
 * The schema rule (`layered`'s, the only place it is applied): content made
 * with another schema than this code has is not read with it. A module's
 * read, and an entry's, which carries its record's schema version.
 */
describe("the schema rule on entries", () => {
  const draft = answering("server-draft", {
    status: "ready",
    content: { title: "Made with the next schema" },
    from: "server-draft",
    version: version("next-schema"),
  });
  const bundle = answering("bundle", {
    status: "ready",
    content: { title: "The bundle's" },
    from: "bundle",
  });

  test("an entry made with another schema is read from the next source", () => {
    const view = layered([draft, bundle], { schemaOf: () => "our-schema" });
    expect(view.entry(PATH, "a")).toMatchObject({ from: "bundle" });
  });

  test("an entry made with this code's schema is read", () => {
    const view = layered([draft, bundle], { schemaOf: () => "next-schema" });
    expect(view.entry(PATH, "a")).toMatchObject({ from: "server-draft" });
  });

  test("with code on its way, the entry waits for it", () => {
    const arriving = Promise.resolve();
    const view = layered([draft, bundle], {
      schemaOf: () => "our-schema",
      codeChanged: () => arriving,
    });
    expect(view.entry(PATH, "a")).toEqual({
      status: "pending",
      ready: arriving,
    });
  });
});

/**
 * A page that could not read what the Studio relayed, for its schema, says
 * so to the editor with a reload -- and takes it back when its own code
 * catches up, which in local development is a hot reload a moment later
 * (`schemaChecked`, `codeChangedReporter`).
 */
describe("what the schema rule tells a page", () => {
  const relayed = answering("overlay", {
    status: "ready",
    content: { title: "Made with the next schema" },
    from: "overlay",
    version: version("next-schema"),
  });
  const bundle = answering("bundle", {
    status: "ready",
    content: { title: "The bundle's" },
    from: "bundle",
  });

  test("an answer passed over for its schema is reported, and one read is reported as read", () => {
    const told: unknown[] = [];
    const schemaChecked = (path: ModuleFilePath, other: unknown) => {
      told.push([path, other]);
    };
    layered([relayed, bundle], {
      schemaOf: () => "our-schema",
      schemaChecked,
    }).entry(PATH, "a");
    layered([relayed, bundle], {
      schemaOf: () => "next-schema",
      schemaChecked,
    }).entry(PATH, "a");
    expect(told).toEqual([
      [PATH, { schema: "next-schema", from: "overlay" }],
      [PATH, null],
    ]);
  });

  test("the page announces what it could not read once a render is over, and takes it back", async () => {
    const announced: ModuleFilePath[][] = [];
    const reporter = codeChangedReporter((modules) => announced.push(modules));
    const read = (schema: string) =>
      layered([relayed, bundle], {
        schemaOf: () => schema,
        schemaChecked: reporter.schemaChecked,
      }).entry(PATH, "a");

    // A render reads the module many times: said once, after it.
    read("our-schema");
    read("our-schema");
    expect(announced).toEqual([]);
    await Promise.resolve();
    expect(announced).toEqual([[PATH]]);
    expect(reporter.modules()).toEqual([PATH]);

    // Still refused: nothing new to say.
    read("our-schema");
    await Promise.resolve();
    expect(announced).toEqual([[PATH]]);

    // The page's code caught up: the notice goes.
    read("next-schema");
    await Promise.resolve();
    expect(announced).toEqual([[PATH], []]);
    expect(reporter.modules()).toEqual([]);

    // Read as it should be, never refused: nothing to say.
    read("next-schema");
    await Promise.resolve();
    expect(announced).toEqual([[PATH], []]);
  });
});
