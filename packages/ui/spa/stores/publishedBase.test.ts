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
    // Read before the publish too, so nothing it caches can outlive the
    // publish that makes it wrong.
    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "Old Value",
    });
    expect(await system.publish([published])).toMatchObject({
      status: "published",
    });
    // Straight after, before any edit moves the chain: only the shipped
    // record changed, and that alone has to move the answer.
    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "New Value",
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

  it("counts a patch somebody else's deploy shipped", async () => {
    /*
     * Another author's patch, pending as far as this tab was told, disappears
     * from the stat as the base moves: published and deployed elsewhere, and
     * no `appliedPatches` ever named it. It is in the repository, so it is
     * published — and until the deployed base arrives, the chain is the only
     * place that says so.
     */
    const theirs: PatchRecord = {
      patchId: "theirs" as PatchId,
      moduleFilePath: MODULE,
      patch: [{ op: "replace", path: ["title"], value: "New Value" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      authorId: "someone-else",
      appliedAt: null,
    };
    const fetched: PatchRecord[] = [theirs];
    const system = makeSystem({ mode: "http", fetched });
    system.stat.receiveStat({
      patches: [theirs.patchId],
      baseSha: "before-deploy",
    });
    await system.patchSync.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(system.sourceStore.peekBase(TITLE)).toMatchObject({
      data: "Old Value",
    });

    // Their deploy: the base moves and the patch is gone from the server.
    fetched.length = 0;
    system.stat.receiveStat({ patches: [], baseSha: "after-deploy" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await edit(system, "Old Value");
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

  it("keeps a shipped patch until the deployed base arrives, then drops it", async () => {
    /*
     * The deploy and the new base arrive by different routes, and the stat
     * comes first. On a hosted project the base is the bundle this tab loaded,
     * so between the stat and the next intake the base is still the
     * pre-deploy text.
     *
     * Dropping the shipped patch on the stat put its effect in neither base
     * nor chain: `peekBase` fell back to the pre-publish value, and the next
     * rebuild of the module reverted it on screen. Keeping it past the intake
     * replays it on a base that already has it. A `replace` would hide both;
     * an array `add` shows them as a missing or a doubled item.
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

    // The stat: the deployment moved, and the patch is no longer listed.
    system.stat.receiveStat({ patches: [], baseSha: "after-deploy" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Still the pre-deploy base here, so the shipped patch still counts.
    expect(system.sourceStore.peekBase(TAGS)).toMatchObject({
      data: ["shipped"],
    });
    // And a rebuild does not lose it: hiding a pending edit replays the chain
    // onto the pre-deploy base.
    await edit(system, "pending");
    system.setPatchGroup([]);
    expect(system.sourceStore.peek(TAGS)).toMatchObject({
      data: ["shipped"],
    });

    // The deployed base arrives, with the item already in it.
    system.host.receive(project({ title: "Old Value", tags: ["shipped"] }));

    expect(system.sourceStore.peekBase(TAGS)).toMatchObject({
      data: ["shipped"],
    });
    expect(system.sourceStore.peek(TAGS)).toMatchObject({
      data: ["shipped"],
    });
    system.dispose();
  });

  it("keeps a shipped entry edit until the entry's own content arrives", async () => {
    /*
     * A `.jsonValues()` module's source is markers; each entry's content is a
     * separate intake that arrives after it. Retiring the patch with the
     * markers left the pre-publish entry content as the base, and the compare
     * reported an already-deployed entry edit as outstanding again.
     */
    const { c, s } = initVal();
    const BLOGS = "/blogs.val.ts" as ModuleFilePath;
    const BLOG_TITLE = '/blogs.val.ts?p="/a"."title"' as SourcePath;
    const blogs = () => [
      c.define(BLOGS, s.record(s.object({ title: s.string() })).jsonValues(), {
        "/a": c.json(() => Promise.resolve({ default: { title: "Alpha" } })),
      }),
    ];
    const system = makeSystem({ mode: "http" });
    system.host.receive(blogs());
    system.sourceStore.receiveJsonEntry(BLOGS, "/a", { title: "Alpha" });

    const res = await system.patchStore.createPatch(BLOGS, [
      { op: "replace", path: ["/a", "title"], value: "Beta" },
    ]);
    if (res.status !== "created") throw new Error(res.status);
    await system.patchSync.flush();
    await system.publish([res.record.patchId]);
    expect(system.sourceStore.peekBase(BLOG_TITLE)).toMatchObject({
      data: "Beta",
    });

    // The deploy, then the deployed markers: the entry content is still the
    // pre-publish text, so the shipped edit has to go on counting.
    system.stat.receiveStat({ patches: [], baseSha: "after-deploy" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    system.host.receive(blogs());
    expect(system.sourceStore.peekBase(BLOG_TITLE)).toMatchObject({
      data: "Beta",
    });

    // Typing carries on in the same entry before its content is refreshed.
    const pending = await system.patchStore.createPatch(BLOGS, [
      { op: "replace", path: ["/a", "title"], value: "Pending" },
    ]);
    if (pending.status !== "created") throw new Error(pending.status);
    await system.patchSync.flush();

    // The deployed entry content arrives, and the patch is retired with it:
    // what the server sends is what counts from here on.
    system.sourceStore.receiveJsonEntry(BLOGS, "/a", { title: "Deployed" });
    expect(system.sourceStore.peekBase(BLOG_TITLE)).toMatchObject({
      data: "Deployed",
    });
    // And the pending edit is still on screen: the intake overwrote the live
    // entry, so only replaying what survives puts it back.
    expect(system.sourceStore.peek(BLOG_TITLE)).toMatchObject({
      data: "Pending",
    });
    system.dispose();
  });

  it("keeps a shipped copy until the entry it reads from arrives too", async () => {
    /*
     * A `copy` reads its `from`. Retiring it once only the entry it WRITES had
     * been refreshed replays it — or drops it — against a source entry that is
     * still the pre-deploy text.
     */
    const { c, s } = initVal();
    const BLOGS = "/blogs.val.ts" as ModuleFilePath;
    const B_TITLE = '/blogs.val.ts?p="/b"."title"' as SourcePath;
    const blogs = () => [
      c.define(BLOGS, s.record(s.object({ title: s.string() })).jsonValues(), {
        "/a": c.json(() => Promise.resolve({ default: { title: "Alpha" } })),
        "/b": c.json(() => Promise.resolve({ default: { title: "Beta" } })),
      }),
    ];
    const system = makeSystem({ mode: "http" });
    system.host.receive(blogs());
    system.sourceStore.receiveJsonEntry(BLOGS, "/a", { title: "Alpha" });
    system.sourceStore.receiveJsonEntry(BLOGS, "/b", { title: "Beta" });

    const res = await system.patchStore.createPatch(BLOGS, [
      { op: "copy", from: ["/a"], path: ["/b"] },
    ]);
    if (res.status !== "created") throw new Error(res.status);
    await system.patchSync.flush();
    await system.publish([res.record.patchId]);
    system.stat.receiveStat({ patches: [], baseSha: "after-deploy" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    system.host.receive(blogs());

    // Only the entry it writes: still waiting on the one it reads.
    system.sourceStore.receiveJsonEntry(BLOGS, "/b", { title: "Deployed" });
    expect(system.sourceStore.peekBase(B_TITLE)).toMatchObject({
      data: "Alpha",
    });

    // Both are current now, so the deployed content is the answer.
    system.sourceStore.receiveJsonEntry(BLOGS, "/a", { title: "Alpha" });
    expect(system.sourceStore.peekBase(B_TITLE)).toMatchObject({
      data: "Deployed",
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
