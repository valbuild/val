import type { ModuleFilePath } from "@valbuild/core";
import type { ContentSource, EntryRead } from "@valbuild/shared/internal";
import { layered } from "./layered";

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
