import { randomUUID } from "crypto";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { raw, stegaDecodeStrings } from "@valbuild/react/stega";
import { InMemoryPatchStore } from "@valbuild/server";
import { createValRuntime } from "@valbuild/server/internal";
import { initFetchValKeyStega, initFetchValStega } from "./initValContent";

const { s, c, config } = initVal();

/**
 * A `.jsonValues()` record whose entries count their imports. A path per test,
 * so one test's imports are not another's.
 */
function notes(path: string) {
  const imports = { a: jest.fn(), b: jest.fn() };
  const module = c.define(
    path as ModuleFilePath,
    s.record(s.object({ title: s.string() })).jsonValues(),
    {
      a: c.json(() => {
        imports.a();
        return Promise.resolve({ default: { title: "Note A" } });
      }),
      b: c.json(() => {
        imports.b();
        return Promise.resolve({ default: { title: "Note B" } });
      }),
    },
  );
  return { module, imports, path: path as ModuleFilePath };
}

const titles = (record: unknown) =>
  Object.fromEntries(
    Object.entries(record as Record<string, { title: string }>).map(
      ([key, note]) => [key, raw(note.title)],
    ),
  );

const headers = async () => ({
  get: (name: string) => (name === "host" ? "localhost:3000" : null),
});
const cookies = async () => ({
  get: (name: string) => ({ name, value: "session" }),
});

/** A real runtime in memory mode for `module`, with these edits pending. */
async function runtimeWith(
  module: ReturnType<typeof notes>,
  ...patches: Patch[]
) {
  const valModules: ValModules = {
    config,
    modules: [{ def: async () => ({ default: module.module }) }],
  };
  const runtime = createValRuntime(
    valModules,
    "/api/val",
    {
      ...config,
      sourceFiles: {},
      patchStore: new InMemoryPatchStore(),
      unsafelyAllowUnauthenticated: true,
    },
    config,
  );
  for (const patch of patches) {
    await (
      await runtime
    ).ops.createPatch(
      module.path,
      patch,
      randomUUID() as PatchId,
      { type: "head", headBaseSha: await (await runtime).ops.getBaseSha() },
      null,
      null,
    );
  }
  return runtime;
}

/*
 * `fetchVal` on a whole `.jsonValues()` record reads EVERY entry's content:
 * its own source holds only lazy markers, and encoding that rendered every
 * entry empty. `fetchValKey` is the reader for one entry, and loads only it.
 */
describe("fetchVal on a .jsonValues() record", () => {
  test("published: every entry's content, imported from the bundle", async () => {
    const notesOf = notes("/server-notes-published.val.ts");
    const fetchVal = initFetchValStega({
      runtime: runtimeWith(notesOf),
      isEnabled: async () => false,
      getHeaders: headers,
      getCookies: cookies,
    });
    expect(titles(await fetchVal(notesOf.module))).toEqual({
      a: "Note A",
      b: "Note B",
    });
    expect(notesOf.imports.a).toHaveBeenCalledTimes(1);
    expect(notesOf.imports.b).toHaveBeenCalledTimes(1);
  });

  test("draft, nothing pending: the record is the bundle's, read from the bundle", async () => {
    const notesOf = notes("/server-notes-draft.val.ts");
    const fetchVal = initFetchValStega({
      runtime: runtimeWith(notesOf),
      isEnabled: async () => true,
      getHeaders: headers,
      getCookies: cookies,
    });
    expect(titles(await fetchVal(notesOf.module))).toEqual({
      a: "Note A",
      b: "Note B",
    });
    expect(notesOf.imports.a).toHaveBeenCalledTimes(1);
    expect(notesOf.imports.b).toHaveBeenCalledTimes(1);
  });

  test("draft: an entry a pending patch edits is the head's patched entry, not the bundle's", async () => {
    const notesOf = notes("/server-notes-pending.val.ts");
    const fetchVal = initFetchValStega({
      runtime: runtimeWith(notesOf, [
        { op: "replace", path: ["a", "title"], value: "Edited A" },
      ]),
      isEnabled: async () => true,
      getHeaders: headers,
      getCookies: cookies,
    });
    expect(titles(await fetchVal(notesOf.module))).toEqual({
      a: "Edited A",
      b: "Note B",
    });
    // Once by the head, for the base entry its edit applies to; the other
    // entry by the bundle, as the reader fills a marker.
    expect(notesOf.imports.a).toHaveBeenCalledTimes(1);
    expect(notesOf.imports.b).toHaveBeenCalledTimes(1);
  });
});

describe("fetchVal on a proposal's .jsonValues() record", () => {
  test("at a proposal's address: the entries its snapshot has, none imported", async () => {
    const notesOf = notes("/server-notes-snapshot.val.ts");
    const fetchVal = initFetchValStega({
      runtime: runtimeWith(notesOf),
      isEnabled: async () => false,
      getHeaders: headers,
      getCookies: cookies,
      snapshot: {
        [notesOf.path]: { a: { title: "Saved A" }, b: { title: "Saved B" } },
      },
    });
    expect(titles(await fetchVal(notesOf.module))).toEqual({
      a: "Saved A",
      b: "Saved B",
    });
    expect(notesOf.imports.a).not.toHaveBeenCalled();
    expect(notesOf.imports.b).not.toHaveBeenCalled();
  });
});

/*
 * S25: a visitor never gets edit tags, not even from the fallback a failed
 * read takes. The fallback called `stegaEncode` without `disabled`, so a
 * visitor whose read threw got the snapshot's strings with tags in them.
 */
describe("fetchVal for a visitor whose read throws", () => {
  test("gives the content without edit tags", async () => {
    const path = "/server-notes-visitor-throws.val.ts" as ModuleFilePath;
    const module = c.define(
      path,
      s.record(s.object({ title: s.string() })).jsonValues(),
      {
        a: c.json(() => Promise.resolve({ default: { title: "Note A" } })),
        b: c.json(
          (): Promise<{ default: { title: string } }> =>
            Promise.reject(new Error("the entry's file is gone")),
        ),
      },
    );
    const fetchVal = initFetchValStega({
      runtime: runtimeWith(notes("/server-notes-unused.val.ts")),
      isEnabled: async () => false,
      getHeaders: headers,
      getCookies: cookies,
      // A proposal's saves have entry a; b is read from the bundle, and throws.
      snapshot: { [path]: { a: { title: "Saved A" }, b: { _type: "json" } } },
    });
    const text = JSON.stringify(await fetchVal(module));
    expect(text).toContain('"title":"Saved A"');
    expect(stegaDecodeStrings(text)).toBeUndefined();
  });
});

describe("fetchValKey on a .jsonValues() record", () => {
  test("loads only the entry it names", async () => {
    const notesOf = notes("/server-notes-key.val.ts");
    const fetchValKey = initFetchValKeyStega({
      runtime: runtimeWith(notesOf),
      isEnabled: async () => false,
      getCookies: cookies,
    });
    const note = await fetchValKey(notesOf.module, "a");
    expect(note && raw(note.title)).toBe("Note A");
    expect(notesOf.imports.a).toHaveBeenCalledTimes(1);
    expect(notesOf.imports.b).not.toHaveBeenCalled();
  });
});
