import { initVal, type ModuleFilePath } from "@valbuild/core";
import { raw } from "@valbuild/react/stega";
import type { RequestScopedMemo } from "@valbuild/shared/internal";
import {
  initFetchValKeyStega,
  initFetchValStega,
  type DraftSources,
  type DraftSourcesValServer,
  type GetDraftSourcesScope,
} from "./initValContent";

const { s, c } = initVal();

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
const scope: GetDraftSourcesScope = async () =>
  ({}) as RequestScopedMemo<DraftSources | null>;

/** A server whose draft view of `path` is `draft`. */
function draftServer(
  path: ModuleFilePath,
  draft: unknown,
): Promise<DraftSourcesValServer> {
  return Promise.resolve({
    "/sources/~": {
      PUT: async () => ({
        status: 200,
        json: {
          schemaSha: "schema-sha",
          sourcesSha: "sources-sha",
          modules: { [path]: { source: draft, preview: null } },
        },
      }),
    },
  } as DraftSourcesValServer);
}

/*
 * `fetchVal` on a whole `.jsonValues()` record reads EVERY entry's content:
 * its own source holds only lazy markers, and encoding that rendered every
 * entry empty. `fetchValKey` is the reader for one entry, and loads only it.
 */
describe("fetchVal on a .jsonValues() record", () => {
  test("published: every entry's content, imported from the bundle", async () => {
    const { module, imports } = notes("/server-notes-published.val.ts");
    const fetchVal = initFetchValStega(
      { project: "test" },
      "/api/val",
      draftServer("/unused.val.ts" as ModuleFilePath, {}),
      async () => false,
      headers,
      cookies,
      scope,
    );
    expect(titles(await fetchVal(module))).toEqual({
      a: "Note A",
      b: "Note B",
    });
    expect(imports.a).toHaveBeenCalledTimes(1);
    expect(imports.b).toHaveBeenCalledTimes(1);
  });

  test("draft: an entry the draft has, and the rest imported from the bundle", async () => {
    const { module, imports, path } = notes("/server-notes-draft.val.ts");
    const fetchVal = initFetchValStega(
      { project: "test" },
      "/api/val",
      draftServer(path, { a: { title: "Edited A" }, b: { _type: "json" } }),
      async () => true,
      headers,
      cookies,
      scope,
    );
    expect(titles(await fetchVal(module))).toEqual({
      a: "Edited A",
      b: "Note B",
    });
    expect(imports.a).not.toHaveBeenCalled();
  });

  test("at a proposal's address: the entries its snapshot has, none imported", async () => {
    const { module, imports, path } = notes("/server-notes-snapshot.val.ts");
    const fetchVal = initFetchValStega(
      { project: "test" },
      "/api/val",
      draftServer("/unused.val.ts" as ModuleFilePath, {}),
      async () => false,
      headers,
      cookies,
      scope,
      { [path]: { a: { title: "Saved A" }, b: { title: "Saved B" } } },
    );
    expect(titles(await fetchVal(module))).toEqual({
      a: "Saved A",
      b: "Saved B",
    });
    expect(imports.a).not.toHaveBeenCalled();
    expect(imports.b).not.toHaveBeenCalled();
  });
});

describe("fetchValKey on a .jsonValues() record", () => {
  test("loads only the entry it names", async () => {
    const { module, imports } = notes("/server-notes-key.val.ts");
    const fetchValKey = initFetchValKeyStega(
      Promise.resolve({} as never),
      async () => false,
      cookies,
    );
    const note = await fetchValKey(module, "a");
    expect(note && raw(note.title)).toBe("Note A");
    expect(imports.a).toHaveBeenCalledTimes(1);
    expect(imports.b).not.toHaveBeenCalled();
  });
});
