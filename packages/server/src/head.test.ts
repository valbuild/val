import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { EMPTY_CHAIN, engineWork, moduleKey } from "@valbuild/shared/internal";
import { InMemoryPatchStore, ValOpsMemory } from "./ValOpsMemory";
import { ValHead, headWork, heldBeyond } from "./head";

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

function setup() {
  const valModules: ValModules = {
    config,
    modules: [homeVal, notesVal].map((module) => ({
      def: async () => ({ default: module }),
    })),
  };
  const ops = new ValOpsMemory(valModules, {
    config,
    sourceFiles: {},
    patchStore: new InMemoryPatchStore(),
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
