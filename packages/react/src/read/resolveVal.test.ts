import { initVal, type Json, type ModuleFilePath } from "@valbuild/core";
import type {
  ContentSource,
  EntryRead,
  ModuleRead,
} from "@valbuild/shared/internal";
import { layered } from "./layered";
import { resolveVal, resolveValEntry, type ReadEnv } from "./resolveVal";
import { awaitResolved } from "./readers";
import { snapshotSource } from "./sources";
import { stegaDecodeStrings } from "../stega/stegaDecodeStrings";

/*
 * Level 1 of the plan's testing (`docs/plans/one-content-model.md`,
 * "Three levels"): the pipeline every reader shares, with scripted sources.
 * `ContentSource` is the boundary, so a source written here is what any real
 * one may answer; what the real ones answer is pinned in the scenarios.
 */

const { s, c } = initVal();
const PATH = "/notes.val.ts" as ModuleFilePath;

/** A source that answers what it is told, and passes on the rest. */
function scripted(
  name: string,
  modules: Record<string, ModuleRead>,
  entries: Record<string, EntryRead> = {},
): ContentSource {
  return {
    name,
    module: (path) => modules[path] ?? { status: "pass" },
    entry: (path, key) => entries[`${path} ${key}`] ?? { status: "pass" },
  };
}

const ready = (source: Json, from = "scripted"): ModuleRead => ({
  status: "ready",
  source,
  from,
  version: null,
});

/** A `.jsonValues()` record whose two entries count their imports. */
function notes() {
  const imports = {
    a: jest.fn(() => Promise.resolve({ default: { title: "Note A" } })),
    b: jest.fn(() => Promise.resolve({ default: { title: "Note B" } })),
  };
  const module = c.define(
    PATH,
    s.record(s.object({ title: s.string() })).jsonValues(),
    { a: c.json(imports.a), b: c.json(imports.b) },
  );
  return { module, imports };
}

const env = (sources: ContentSource[], encode = false): ReadEnv => ({
  sources,
  encode,
});

describe("layered: the first source that does not pass wins", () => {
  test("a source with an answer wins over the ones after it", () => {
    const view = layered([
      scripted("first", {}),
      scripted("second", { [PATH]: ready("two", "second") }),
      scripted("third", { [PATH]: ready("three", "third") }),
    ]);
    expect(view.module(PATH)).toEqual({ read: ready("two", "second"), at: 1 });
  });

  test("nobody answering is a pass: the reader's own bundle", () => {
    expect(layered([scripted("a", {})]).module(PATH)).toEqual({
      read: { status: "pass" },
      at: -1,
    });
  });

  test("pending is an answer to wait for, not a reason to read the next one", () => {
    const wait = new Promise<void>(() => {});
    const view = layered([
      scripted("first", { [PATH]: { status: "pending", ready: wait } }),
      scripted("second", { [PATH]: ready("published") }),
    ]);
    expect(view.module(PATH).read).toEqual({ status: "pending", ready: wait });
  });

  test("a wait that is over and still pending is passed over", () => {
    const wait = Promise.resolve();
    const view = layered(
      [
        scripted("first", { [PATH]: { status: "pending", ready: wait } }),
        scripted("second", { [PATH]: ready("published", "second") }),
      ],
      undefined,
      new Set([wait]),
    );
    expect(view.module(PATH).read).toEqual(ready("published", "second"));
  });

  /*
   * What the single-entry readers' `resolveDraftOrCommittedEntry` decided,
   * in both frameworks, before `layered` replaced it: the draft wins when it
   * has an answer -- including "this entry is gone" -- and the published
   * entry is read only when the draft has none.
   */
  test("draft content wins over the published entry", () => {
    const view = layered([
      scripted(
        "draft",
        {},
        { [`${PATH} a`]: { status: "ready", content: 1, from: "draft" } },
      ),
      scripted(
        "bundle",
        {},
        { [`${PATH} a`]: { status: "ready", content: 2, from: "bundle" } },
      ),
    ]);
    expect(view.entry(PATH, "a")).toEqual({
      status: "ready",
      content: 1,
      from: "draft",
    });
  });

  test("gone means gone: the published entry is not asked", () => {
    const published = jest.fn(
      (): EntryRead => ({ status: "ready", content: 2, from: "bundle" }),
    );
    const view = layered([
      scripted(
        "draft",
        {},
        { [`${PATH} a`]: { status: "gone", from: "draft" } },
      ),
      { name: "bundle", module: () => ({ status: "pass" }), entry: published },
    ]);
    expect(view.entry(PATH, "a")).toEqual({ status: "gone", from: "draft" });
    expect(published).not.toHaveBeenCalled();
  });

  test("a draft that cannot say falls back to the published entry", () => {
    const view = layered([
      scripted("draft", {}),
      scripted(
        "bundle",
        {},
        { [`${PATH} a`]: { status: "ready", content: 2, from: "bundle" } },
      ),
    ]);
    expect(view.entry(PATH, "a")).toEqual({
      status: "ready",
      content: 2,
      from: "bundle",
    });
    expect(layered([scripted("draft", {})]).entry(PATH, "a")).toEqual({
      status: "pass",
    });
  });
});

describe("layered: content is only read with the schema it was made for", () => {
  const version = { schema: "theirs", base: "b", chain: "" };
  const other = scripted("server-draft", {
    [PATH]: { status: "ready", source: "draft", from: "server-draft", version },
  });

  test("an answer made with another schema is not read: the next source is", () => {
    const view = layered(
      [other, scripted("snapshot", { [PATH]: ready("saved", "snapshot") })],
      { schemaOf: () => "ours" },
    );
    expect(view.module(PATH).read).toEqual(ready("saved", "snapshot"));
  });

  test("with somewhere to wait for the code, it waits", () => {
    const codeChanged = new Promise<void>(() => {});
    const view = layered([other], {
      schemaOf: () => "ours",
      codeChanged: () => codeChanged,
    });
    expect(view.module(PATH).read).toEqual({
      status: "pending",
      ready: codeChanged,
    });
  });

  test("the same schema is read", () => {
    const view = layered([other], { schemaOf: () => "theirs" });
    expect(view.module(PATH).read.status).toBe("ready");
  });
});

describe("resolveVal on a whole .jsonValues() record", () => {
  test("each entry from the first source that has its content, the rest imported together", async () => {
    const { module, imports } = notes();
    const draft = scripted("overlay", {
      [PATH]: ready({ a: { _type: "json" }, b: { _type: "json" } }, "overlay"),
    });
    const saved = snapshotSource({ [PATH]: { a: { title: "Saved A" } } });
    const first = resolveVal(module, env([draft, saved]));
    expect(first.status).toBe("pending");
    // The snapshot had a; only b is imported.
    expect(imports.a).not.toHaveBeenCalled();
    expect(imports.b).toHaveBeenCalledTimes(1);
    const { value, reads } = await awaitResolved((settled) =>
      resolveVal(module, env([draft, saved]), { settled }),
    );
    expect(value).toEqual({
      a: { title: "Saved A" },
      b: { title: "Note B" },
    });
    expect(reads).toEqual([{ path: PATH, from: "overlay", version: null }]);
    expect(imports.b).toHaveBeenCalledTimes(1);
  });

  test("an entry whose import fails keeps its marker, and the rest render", async () => {
    const module = c.define(
      "/failing.val.ts",
      s.record(s.object({ title: s.string() })).jsonValues(),
      {
        a: c.json(() => Promise.resolve({ default: { title: "Note A" } })),
        b: c.json(
          (): Promise<{ default: { title: string } }> =>
            Promise.reject(new Error("the entry's file is gone")),
        ),
      },
    );
    const { value } = await awaitResolved((settled) =>
      resolveVal(module, env([]), { settled }),
    );
    expect(value.a).toEqual({ title: "Note A" });
    expect(value.b).toEqual(expect.objectContaining({ _type: "json" }));
  });

  test("entries: false imports nothing", async () => {
    const { module, imports } = notes();
    const r = resolveVal(module, env([]), { entries: false });
    expect(r.status).toBe("ready");
    expect(imports.a).not.toHaveBeenCalled();
    expect(imports.b).not.toHaveBeenCalled();
  });

  test("edit tags are the env's: encoded when it says so, never otherwise", async () => {
    const { module } = notes();
    const plain = await awaitResolved((settled) =>
      resolveVal(module, env([], false), { settled }),
    );
    expect(stegaDecodeStrings(JSON.stringify(plain.value))).toBeUndefined();
    const tagged = await awaitResolved((settled) =>
      resolveVal(module, env([], true), { settled }),
    );
    expect(stegaDecodeStrings(JSON.stringify(tagged.value))).toBeDefined();
  });
});

describe("resolveValEntry", () => {
  test("loads the entry it names and no other", async () => {
    const { module, imports } = notes();
    const { value } = await awaitResolved((settled) =>
      resolveValEntry(module, "a", env([]), { settled }),
    );
    expect(value).toEqual({ title: "Note A" });
    expect(imports.a).toHaveBeenCalledTimes(1);
    expect(imports.b).not.toHaveBeenCalled();
  });

  test("an entry a source says is gone is undefined, and not imported", async () => {
    const { module, imports } = notes();
    // A whole module's source answers for its entries (`entryOfModuleSource`):
    // a key it does not have is gone.
    const draft = snapshotSource({ [PATH]: { b: { _type: "json" } } });
    const { value } = await awaitResolved((settled) =>
      resolveValEntry(module, "a", env([draft]), { settled }),
    );
    expect(value).toBeUndefined();
    expect(imports.a).not.toHaveBeenCalled();
  });

  test("an entry whose import fails throws, as the import did", async () => {
    const module = c.define(
      "/failing-entry.val.ts",
      s.record(s.object({ title: s.string() })).jsonValues(),
      {
        a: c.json(
          (): Promise<{ default: { title: string } }> =>
            Promise.reject(new Error("the entry's file is gone")),
        ),
      },
    );
    await expect(
      awaitResolved((settled) =>
        resolveValEntry(module, "a", env([]), { settled }),
      ),
    ).rejects.toThrow("the entry's file is gone");
  });
});
