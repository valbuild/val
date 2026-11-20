import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SelectorSource,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { EMPTY_CHAIN, engineWork, moduleKey } from "@valbuild/shared/internal";
import {
  InMemoryPatchStore,
  ValOpsMemory,
  type ValPatchStore,
} from "./ValOpsMemory";
import { ValHead, headWork, heldBeyond, isLastingAnswer } from "./head";
import { serverDraftSource } from "./draftReads";

/**
 * The head: the content at the newest chain, made once per version and kept
 * by it (phase 6 of `docs/plans/one-content-model.md`). The scenarios budget
 * what it costs a page (B06, B11-B13); these pin how a version is made.
 */

const { s, c, config } = initVal();
const HOME = "/content/home.val.ts" as ModuleFilePath;
const NOTES = "/content/notes.val.ts" as ModuleFilePath;
const homeVal = c.define(
  HOME,
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);
const notesVal = c.define(
  NOTES,
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    a: c.json(async () => ({ default: { title: "Note A" } })),
    b: c.json(async () => ({ default: { title: "Note B" } })),
  },
);

function setup(
  opts: {
    modules?: ValModule<SelectorSource>[];
    patchStore?: ValPatchStore;
  } = {},
) {
  const valModules: ValModules = {
    config,
    modules: (opts.modules ?? [homeVal, notesVal]).map((module) => ({
      def: async () => ({ default: module }),
    })),
  };
  const ops = new ValOpsMemory(valModules, {
    config,
    sourceFiles: {},
    patchStore: opts.patchStore ?? new InMemoryPatchStore(),
    unsafelyAllowUnauthenticated: true,
    warnUnauthenticated: false,
  });
  let n = 0;
  const edit = async (path: ModuleFilePath, patch: Patch) => {
    const patchId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    await ops.createPatch(
      path,
      patch,
      patchId as PatchId,
      { type: "head", headBaseSha: await ops.getBaseSha() },
      null,
      null,
    );
    return patchId as PatchId;
  };
  return { ops, edit };
}

async function moduleOf(head: ValHead, path: ModuleFilePath) {
  const read = await head.module(path);
  if ("error" in read || read.ok === null) throw new Error("no module");
  return read.ok;
}

test("an unpatched module is the bundle's own, and nothing is made for it", async () => {
  const { ops } = setup();
  const before = headWork().materialized;
  const draft = await ops.head.draft(HOME);
  expect("ok" in draft && draft.ok?.kind).toBe("bundle");
  expect(headWork().materialized).toBe(before);
  expect(ops.head.stats().versions).toBe(0);
});

test("a keystroke extends the version before by its one patch", async () => {
  const { ops, edit } = setup();
  await edit(HOME, [{ op: "replace", path: ["title"], value: "One" }]);
  expect((await moduleOf(ops.head, HOME)).module.content.source).toEqual({
    title: "One",
    subtitle: "Sub",
  });
  await edit(HOME, [{ op: "replace", path: ["subtitle"], value: "Two" }]);
  const before = { head: headWork(), engine: engineWork() };
  const read = await moduleOf(ops.head, HOME);
  expect(read.module.content.source).toEqual({ title: "One", subtitle: "Two" });
  expect(headWork().extended).toBe(before.head.extended + 1);
  expect(engineWork().applyPatch).toBe(before.engine.applyPatch + 1);
  // Read again: nothing is made.
  const again = headWork().materialized;
  expect((await moduleOf(ops.head, HOME)).module).toBe(read.module);
  expect(headWork().materialized).toBe(again);
});

test("a discard in the middle replays the module from its base", async () => {
  const { ops, edit } = setup();
  const first = await edit(HOME, [
    { op: "replace", path: ["title"], value: "One" },
  ]);
  await edit(HOME, [{ op: "replace", path: ["subtitle"], value: "Two" }]);
  await moduleOf(ops.head, HOME);
  await ops.deletePatches([first]);
  const before = headWork();
  const read = await moduleOf(ops.head, HOME);
  expect(read.module.content.source).toEqual({
    title: "Hello",
    subtitle: "Two",
  });
  expect(headWork().materialized).toBe(before.materialized + 1);
  expect(headWork().extended).toBe(before.extended);
});

test("over its byte budget it lets the least recently read module go, and makes it again when read", async () => {
  const { ops, edit } = setup();
  const head = new ValHead(ops, { budgetBytes: 1 });
  await edit(HOME, [{ op: "replace", path: ["title"], value: "One" }]);
  await edit(NOTES, [{ op: "add", path: ["c"], value: { title: "Note C" } }]);
  await moduleOf(head, HOME);
  await moduleOf(head, NOTES);
  expect(head.stats().modules).toBe(1);
  const before = headWork().materialized;
  expect((await moduleOf(head, HOME)).module.content.source).toEqual({
    title: "One",
    subtitle: "Sub",
  });
  expect(headWork().materialized).toBe(before + 1);
});

test("an entry's version moves with the patches that touch it, and no others", async () => {
  const { ops, edit } = setup();
  await edit(NOTES, [{ op: "replace", path: ["a", "title"], value: "A1" }]);
  const first = await ops.head.entries(NOTES, ["a", "b"]);
  if (first.status !== "success") throw new Error(first.status);
  expect(first.value.entries).toEqual([
    { key: "a", content: { title: "A1" } },
    { key: "b", content: { title: "Note B" } },
  ]);
  const a1 = first.value.entryVersions["a"];
  const b1 = first.value.entryVersions["b"];
  expect(a1?.chain).not.toBe(EMPTY_CHAIN);
  expect(b1?.chain).toBe(EMPTY_CHAIN);

  await edit(NOTES, [{ op: "replace", path: ["a", "title"], value: "A2" }]);
  const second = await ops.head.entries(NOTES, ["a", "b"]);
  if (second.status !== "success") throw new Error(second.status);
  expect(second.value.entryVersions["a"]?.chain).not.toBe(a1?.chain);
  expect(second.value.entryVersions["b"]).toEqual(b1);

  await edit(NOTES, [{ op: "replace", path: ["b", "title"], value: "B1" }]);
  const third = await ops.head.entries(NOTES, ["a", "b"]);
  if (third.status !== "success") throw new Error(third.status);
  expect(third.value.entryVersions["a"]).toEqual(
    second.value.entryVersions["a"],
  );
  expect(third.value.entryVersions["b"]?.chain).not.toBe(EMPTY_CHAIN);
});

test("a draft of a record holds the entries its chain touched, and markers for the rest", async () => {
  const { ops, edit } = setup();
  await edit(NOTES, [{ op: "replace", path: ["a", "title"], value: "A1" }]);
  const draft = await ops.head.draft(NOTES);
  if ("error" in draft || draft.ok?.kind !== "draft") throw new Error();
  expect(draft.ok.source).toEqual({
    a: { title: "A1" },
    b: { _type: "json" },
  });
  expect(draft.ok.changed).toBe(true);
});

test("the module endpoint answers a delta from a version the caller holds, and a base by its version", async () => {
  const { ops, edit } = setup();
  await edit(NOTES, [{ op: "replace", path: ["a", "title"], value: "A1" }]);
  const held = await moduleOf(ops.head, NOTES);
  const second = await edit(NOTES, [
    { op: "replace", path: ["b", "title"], value: "B1" },
  ]);
  const delta = await ops.head.answer(NOTES, {
    have: moduleKey(NOTES, held.module.version),
  });
  expect("ok" in delta && delta.ok).toMatchObject({
    kind: "delta",
    from: held.module.version,
    patches: [{ patchId: second }],
  });
  const whole = await ops.head.answer(NOTES, {});
  if ("error" in whole || whole.ok?.kind !== "module") throw new Error();
  // The entries its chain touched, read, each with its own version.
  expect(whole.ok.entries).toMatchObject({
    a: { content: { title: "A1" }, version: { key: "a" } },
    b: { content: { title: "B1" }, version: { key: "b" } },
  });
  const base = { ...whole.ok.version, chain: EMPTY_CHAIN };
  const byBase = await ops.head.answer(NOTES, { v: moduleKey(NOTES, base) });
  expect("ok" in byBase && byBase.ok).toMatchObject({
    kind: "module",
    version: base,
    source: { a: { _type: "json" }, b: { _type: "json" } },
    entries: {},
  });
});

test("what a version holds beyond its base is its copied containers and the values brought", () => {
  const base = { title: "Hello", items: [{ name: "a" }, { name: "b" }] };
  expect(heldBeyond(base, base)).toBe(0);
  const edited = { ...base, title: "Typed" };
  // The root's two slots, and the string.
  expect(heldBeyond(base, edited)).toBe(8 * 2 + "Typed".length);
  const item = { name: "c" };
  const inserted = { ...base, items: [item, ...base.items] };
  // The root, the list's three slots, and the one new item: the shifted ones
  // are the base's own.
  expect(heldBeyond(base, inserted)).toBe(8 * 2 + 8 * 3 + 8 + 1);
});

// #region review fixes

test("a fetch of the chain that throws is the caller's error, and nobody else's", async () => {
  const { ops } = setup();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    jest
      .spyOn(ops, "fetchPatches")
      .mockRejectedValueOnce(new Error("content service went away"));
    await expect(ops.head.sync()).rejects.toThrow("content service went away");
    // Let a rejection nobody holds surface, if there is one.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unhandled).toEqual([]);
    // And the next read is not stuck joining the failed one.
    const again = await ops.head.sync();
    expect("ok" in again).toBe(true);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

/**
 * A patch store shared by isolates, as a Durable Object is: each isolate has
 * its own object in front of the one store, and counts only its own writes.
 */
function sharedStore(inner: InMemoryPatchStore): ValPatchStore {
  return {
    list: () => inner.list(),
    get: (patchId) => inner.get(patchId),
    append: (patch) => inner.append(patch),
    delete: (patchIds) => inner.delete(patchIds),
    putFile: (file) => inner.putFile(file),
    getFile: (patchId, filePath) => inner.getFile(patchId, filePath),
    deleteFile: (patchId, filePath) => inner.deleteFile(patchId, filePath),
    filesOf: (patchId) => inner.filesOf(patchId),
  };
}

test("a store another isolate writes to is read again, not trusted to this isolate's count", async () => {
  const inner = new InMemoryPatchStore();
  const here = setup({ patchStore: sharedStore(inner) });
  const there = setup({ patchStore: sharedStore(inner) });
  expect((await moduleOf(here.ops.head, HOME)).module.content.source).toEqual({
    title: "Hello",
    subtitle: "Sub",
  });
  await there.edit(HOME, [
    { op: "replace", path: ["title"], value: "From there" },
  ]);
  expect((await moduleOf(here.ops.head, HOME)).module.content.source).toEqual({
    title: "From there",
    subtitle: "Sub",
  });
});

test("a draft request asks whether the chain moved once, whatever it reads", async () => {
  const { ops, edit } = setup();
  await edit(HOME, [{ op: "replace", path: ["title"], value: "One" }]);
  await edit(NOTES, [{ op: "replace", path: ["a", "title"], value: "A1" }]);
  const source = serverDraftSource({
    runtime: Promise.resolve({ ops, authorize: () => true }),
    session: undefined,
    modules: true,
  });
  const before = headWork().seqReads;
  const reads = [
    () => source.module(HOME),
    () => source.module(NOTES),
    () => source.entry(NOTES, "a"),
    () => source.entry(NOTES, "b"),
  ];
  for (const read of reads) {
    const first = read();
    if (first.status === "pending") await first.ready;
  }
  expect(reads.map((read) => read().status)).toEqual([
    "ready",
    "ready",
    "ready",
    "ready",
  ]);
  expect(headWork().seqReads - before).toBe(1);
});

test("a draft made at a chain reads its entries at that chain, though the chain has moved since", async () => {
  const { ops, edit } = setup();
  await edit(NOTES, [{ op: "replace", path: ["a", "title"], value: "A1" }]);
  const synced = await ops.head.sync();
  if ("error" in synced) throw new Error(synced.error.message);
  await edit(NOTES, [{ op: "replace", path: ["a", "title"], value: "A2" }]);
  const draft = await ops.head.draft(NOTES, synced.ok);
  if ("error" in draft || draft.ok?.kind !== "draft") throw new Error();
  expect(draft.ok.version).toEqual(synced.ok.versions[NOTES]);
  expect(draft.ok.source).toEqual({
    a: { title: "A1" },
    b: { _type: "json" },
  });
});

test("a module path that names a property of every object is no module", async () => {
  const { ops } = setup();
  for (const path of ["constructor", "toString", "__proto__"]) {
    const read = await ops.head.module(path as ModuleFilePath);
    expect(read).toEqual({ ok: null });
    const answer = await ops.head.answer(path as ModuleFilePath, {});
    expect(answer).toEqual({ ok: null });
  }
});

test("an entry that could not be read is read again, and its answer is not kept for good", async () => {
  const FLAKY = "/content/flaky.val.ts" as ModuleFilePath;
  let calls = 0;
  const flakyVal = c.define(
    FLAKY,
    s.record(s.object({ title: s.string() })).jsonValues(),
    {
      a: c.json(async () => {
        calls++;
        if (calls === 1) throw new Error("chunk failed to load");
        return { default: { title: "Note A" } };
      }),
    },
  );
  const { ops, edit } = setup({ modules: [flakyVal] });
  // An edit held for the entry, so it is read from its base.
  await edit(FLAKY, [{ op: "replace", path: ["a", "title"], value: "A1" }]);

  const first = await ops.head.answer(FLAKY, {});
  if ("error" in first || first.ok?.kind !== "module") throw new Error();
  expect(first.ok.entries["a"]).toMatchObject({
    error: expect.stringContaining("chunk failed to load"),
  });
  expect(isLastingAnswer(first.ok)).toBe(false);

  const second = await ops.head.answer(FLAKY, {});
  if ("error" in second || second.ok?.kind !== "module") throw new Error();
  expect(second.ok.entries["a"]).toMatchObject({ content: { title: "A1" } });
  expect(isLastingAnswer(second.ok)).toBe(true);
});

test("a draft whose entries could not be read is made again on the next read", async () => {
  const FLAKY = "/content/flaky.val.ts" as ModuleFilePath;
  let calls = 0;
  const flakyVal = c.define(
    FLAKY,
    s.record(s.object({ title: s.string() })).jsonValues(),
    {
      a: c.json(async () => {
        calls++;
        if (calls === 1) throw new Error("chunk failed to load");
        return { default: { title: "Note A" } };
      }),
    },
  );
  const { ops, edit } = setup({ modules: [flakyVal] });
  await edit(FLAKY, [{ op: "replace", path: ["a", "title"], value: "A1" }]);
  const first = await ops.head.draft(FLAKY);
  if ("error" in first || first.ok?.kind !== "draft") throw new Error();
  expect(first.ok.entriesFailed).toBe(true);
  const second = await ops.head.draft(FLAKY);
  if ("error" in second || second.ok?.kind !== "draft") throw new Error();
  expect(second.ok.entriesFailed).toBe(false);
  expect(second.ok.source).toEqual({ a: { title: "A1" } });
});
