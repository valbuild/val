import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import type { ActivitySink } from "./activity";
import { createSystem, type System } from "./createSystem";
import type { PatchRecord } from "./types";

/**
 * "A"→"B", publish, "B"→"A" — and Publish must stay enabled.
 *
 * In `http` mode a published patch stays in the chain until the next deployment
 * moves the base, so for that whole window the base is the text from BEFORE the
 * publish. `peekBase` read that base alone, so the edit back to "A" compared
 * equal to it: `useHasNetChanges` answered "nothing to publish", Publish was
 * disabled, and the review screen filed the change under "reverted" — while the
 * repository said "B" and the change back to "A" was exactly what publishing
 * would have done.
 *
 * What has been PUBLISHED is the base plus every patch that has shipped, and
 * that is what `peekBase` answers now.
 */

const MODULE = "/a.val.ts" as ModuleFilePath;
const TITLE = '/a.val.ts?p="title"' as SourcePath;
const TAGS = '/a.val.ts?p="tags"' as SourcePath;
const ROOT = "/a.val.ts" as SourcePath;

/** The module as a deployment serves it: `title` and `tags` as given. */
const project = (
  deployed: { title: string; tags: string[] } = {
    title: "Old Value",
    tags: [],
  },
) => {
  const { c, s } = initVal();
  return [
    c.define(
      MODULE,
      s.object({ title: s.string(), tags: s.array(s.string()) }),
      deployed,
    ),
  ];
};

function makeSystem(options: {
  mode: "fs" | "http";
  fetched?: PatchRecord[];
  activity?: ActivitySink;
}): System {
  const system = createSystem({
    activity: options.activity,
    savePatches: async ({ patches, parentRef }) => ({
      status: "saved",
      newPatchIds: patches.map((patch) => patch.patchId),
      parentRef,
    }),
    fetchPatches: async (patchIds) => ({
      patches: (options.fetched ?? []).filter((record) =>
        patchIds.includes(record.patchId),
      ),
    }),
    createPatchId: (() => {
      let next = 0;
      return () => `p${++next}` as PatchId;
    })(),
    mode: options.mode,
    publishPatches: async () => ({ status: "published" }),
  });
  system.host.receive(project());
  // The first stat is what lets a save go out: it names the parent to save on.
  system.stat.receiveStat({ patches: [], baseSha: "before-deploy" });
  return system;
}

async function edit(system: System, value: string): Promise<PatchId> {
  const res = await system.patchStore.createPatch(MODULE, [
    { op: "replace", path: ["title"], value },
  ]);
  if (res.status !== "created") {
    throw new Error(`Could not create the patch: ${res.status}`);
  }
  // Saved before anything is published, or the save landing mid-publish moves
  // the chain and the publish is refused as `chain-moved`.
  await system.patchSync.flush();
  return res.record.patchId;
}

describe("peekBase counts what has shipped", () => {
  it("sees this session's own publish in http mode", async () => {
    const system = makeSystem({ mode: "http" });
    const published = await edit(system, "New Value");
    expect(await system.publish([published])).toMatchObject({
      status: "published",
    });

    await edit(system, "Old Value");

    // On screen: what the editor typed back.
    expect(system.sourceStore.peek(TITLE)).toMatchObject({
      status: "ready",
      data: "Old Value",
    });
    // Published: what the repository has. Reading "Old Value" here is the bug —
    // both sides equal, and Publish disabled on a real change.
    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      status: "ready",
      data: "New Value",
    });
    expect(system.sourceStore.peekBase(ROOT)).toMatchObject({
      status: "ready",
      data: { title: "New Value" },
    });
    system.dispose();
  });

  it("sees a publish the server reports, as after a reload", async () => {
    /*
     * A fresh tab, between publish and deploy: the base is the deployed text,
     * and the shipped patch arrives from the server with `appliedAt` set.
     */
    const shipped: PatchRecord = {
      patchId: "shipped" as PatchId,
      moduleFilePath: MODULE,
      patch: [{ op: "replace", path: ["title"], value: "New Value" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      authorId: "me",
      appliedAt: { commitSha: "abc123" },
    };
    const system = makeSystem({ mode: "http", fetched: [shipped] });
    system.stat.receiveStat({ patches: [shipped.patchId], baseSha: "sha" });
    await system.patchSync.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "New Value",
    });

    await edit(system, "Old Value");

    expect(system.sourceStore.peek(TITLE)).toMatchObject({
      data: "Old Value",
    });
    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "New Value",
    });
    system.dispose();
  });

  it("leaves pending patches out", async () => {
    const system = makeSystem({ mode: "http" });
    await edit(system, "New Value");

    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "Old Value",
    });
    system.dispose();
  });

  it("is reference-stable while nothing moves", async () => {
    const system = makeSystem({ mode: "http" });
    const published = await edit(system, "New Value");
    await system.publish([published]);
    await edit(system, "Old Value");

    // A `useSyncExternalStore` snapshot: a fresh object per call re-renders
    // forever.
    expect(system.sourceStore.peekBase(TITLE)).toBe(
      system.sourceStore.peekBase(TITLE),
    );
    system.dispose();
  });

  it("does not replay a shipped patch once the deploy has moved the base", async () => {
    /*
     * The deploy is what ends the window. The new base already contains the
     * shipped patch, and the server stops listing it — so it has to leave the
     * source store's chain too, or `peekBase` applies it a second time. A
     * `replace` would hide that; an array `add` doubles the item.
     */
    const system = makeSystem({ mode: "http" });
    const res = await system.patchStore.createPatch(MODULE, [
      { op: "add", path: ["tags", "-"], value: "shipped" },
    ]);
    if (res.status !== "created") throw new Error(res.status);
    await system.patchSync.flush();
    await system.publish([res.record.patchId]);
    expect(system.sourceStore.peekBase(TAGS)).toMatchObject({
      data: ["shipped"],
    });

    // The deploy: the new base has the item, and the patch is no longer listed.
    system.stat.receiveStat({ patches: [], baseSha: "after-deploy" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    system.host.receive(project({ title: "Old Value", tags: ["shipped"] }));

    expect(system.sourceStore.peekBase(TAGS)).toMatchObject({
      data: ["shipped"],
    });
    system.dispose();
  });

  it("does not recompute the published base on a pending edit", async () => {
    /*
     * The module revision moves on every keystroke. Keyed on it, the published
     * base re-applied every shipped patch to a clone of the whole module per
     * edit, for an answer that had not changed.
     */
    const applied: string[] = [];
    const system = makeSystem({
      mode: "http",
      activity: {
        work: (kind, subject) => {
          if (kind === "source:apply-patch" && subject !== undefined) {
            applied.push(subject);
          }
        },
      },
    });
    const published = await edit(system, "New Value");
    await system.publish([published]);
    system.sourceStore.peekBase(TITLE);
    const before = applied.filter((id) => id === published).length;

    for (const value of ["N", "Ne", "New", "Old Value"]) {
      await edit(system, value);
      system.sourceStore.peekBase(TITLE);
    }

    expect(applied.filter((id) => id === published).length).toBe(before);
    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "New Value",
    });
    system.dispose();
  });

  it("wakes readers of the path when a visible patch ships", async () => {
    /*
     * Nothing on screen moves when an already-visible patch is marked shipped,
     * but `peekBase` does — and the "before" side of a compare reads it through
     * a per-path subscription. Without a wake it keeps the pre-publish value.
     */
    const system = makeSystem({ mode: "http" });
    const published = await edit(system, "New Value");
    let woken = 0;
    const off = system.sourceStore.addListener(TITLE, "compare-before", () => {
      woken++;
    });

    await system.publish([published]);

    expect(woken).toBeGreaterThan(0);
    off();
    system.dispose();
  });

  it("agrees with fs mode, where a publish bakes into the base", async () => {
    const system = makeSystem({ mode: "fs" });
    const published = await edit(system, "New Value");
    await system.publish([published]);
    await edit(system, "Old Value");

    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "New Value",
    });
    system.dispose();
  });
});
