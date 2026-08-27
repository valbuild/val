import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, takeNamedPrefix, type System } from "./createSystem";

/**
 * Publishing while someone is still typing.
 *
 * The manual Save button and a timer want different things, and running the
 * timer through the button's rules is why auto-save never worked. Save waits for
 * the write queue to drain and refuses if the chain moved under it — both right
 * for a person who clicked and expects their last word included. On a timer the
 * queue may never be empty and the chain moves constantly, so those two rules
 * mean it simply never runs.
 *
 * `exact` mode names a batch instead: the chain is expected to grow, and only
 * what was named is published.
 */
const project = () => {
  const { c, s } = initVal();
  return [
    c.define("/a.val.ts", s.object({ title: s.string() }), {
      title: "published",
    }),
    c.define("/list.val.ts", s.object({ items: s.array(s.string()) }), {
      items: ["one"],
    }),
  ];
};

function makeSystem(options?: {
  onPublish?: (patchIds: PatchId[]) => Promise<void>;
  holdSaves?: boolean;
}) {
  const publishes: PatchId[][] = [];
  const held: (() => void)[] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `p${++next}` as PatchId;
    })(),
    saveFlushTimeoutMs: 20,
    savePatches: async ({ patches, parentRef }) => {
      const patchIds = patches.map((patch) => patch.patchId);
      if (options?.holdSaves) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return { status: "saved", newPatchIds: patchIds, parentRef };
    },
    publishPatches: async (request) => {
      publishes.push(request.patchIds);
      await options?.onPublish?.(request.patchIds);
      return { status: "published" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return { system, publishes, releaseSaves: () => held.forEach((r) => r()) };
}

const edit = async (
  system: System,
  moduleFilePath: string,
  patch: Parameters<System["patchStore"]["createPatch"]>[1],
): Promise<PatchId> => {
  const res = await system.patchStore.createPatch(
    moduleFilePath as ModuleFilePath,
    patch,
  );
  if (res.status !== "created") {
    throw new Error(`createPatch failed: ${res.status}`);
  }
  return res.record.patchId;
};

const setTitle = (system: System, value: string) =>
  edit(system, "/a.val.ts", [{ op: "replace", path: ["title"], value }]);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Branding a literal, once, rather than at every call site. */
const sp = (path: string): SourcePath => path as SourcePath;

/**
 * What the debounce buys in the real thing: by the time the timer fires, the
 * write queue has drained and the batch is on the server. `exact` mode never
 * waits for that itself — it publishes the prefix that IS saved — so a test that
 * did not wait would be testing the empty prefix.
 */
const saved = (system: System) => system.patchSync.flush();

const titleOf = async (system: System): Promise<unknown> => {
  const read = await system.sourceStore.get(sp('/a.val.ts?p="title"'), null);
  if (read.status !== "resolved-head") {
    throw new Error(`expected a value, got ${read.status}`);
  }
  return read.data;
};

describe("takeNamedPrefix", () => {
  const set = (...ids: string[]) => new Set(ids as PatchId[]);
  const chain = ["a", "b", "c"] as PatchId[];

  it("takes the whole chain when all of it was named", () => {
    expect(takeNamedPrefix(chain, set("a", "b", "c"), set())).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("stops at the first id nobody named", () => {
    expect(takeNamedPrefix(chain, set("a", "b"), set())).toEqual(["a", "b"]);
  });

  /**
   * The safety property. Committing `c` while `b` stays pending would write a
   * file that no ordering of what is left can explain — so a gap ends the
   * prefix rather than being skipped over.
   */
  it("stops at a gap rather than skipping it", () => {
    expect(takeNamedPrefix(chain, set("a", "c"), set())).toEqual(["a"]);
  });

  it("stops at a patch the server does not have yet", () => {
    expect(takeNamedPrefix(chain, set("a", "b", "c"), set("b"))).toEqual(["a"]);
  });

  it("takes nothing when the head of the chain is not named", () => {
    expect(takeNamedPrefix(chain, set("b", "c"), set())).toEqual([]);
  });
});

describe("publishing in exact mode", () => {
  it("publishes the batch it named and leaves the rest pending", async () => {
    const { system, publishes } = makeSystem();
    const first = await setTitle(system, "one");
    const second = await setTitle(system, "two");
    await saved(system);

    const res = await system.publish([first], undefined, { exact: true });

    expect(res.status).toBe("published");
    expect(publishes).toEqual([[first]]);
    expect(system.patchStore.pendingPatchIds().concat()).not.toContain(first);
    expect(
      system.patchStore.allRecords().map((record) => record.patchId),
    ).toEqual([second]);
    system.dispose();
  });

  /**
   * The refusal that made auto-save unreachable. Under the button's rules this
   * is `unsaved-changes`, every time, because a field writes on a pause and the
   * queue is rarely empty while someone types.
   */
  it("does not refuse because something newer is still being saved", async () => {
    const { system, publishes, releaseSaves } = makeSystem({ holdSaves: true });
    const first = await setTitle(system, "one");
    await settle();
    releaseSaves();
    await settle();
    // This one is stuck in the write queue.
    await setTitle(system, "two");

    const res = await system.publish([first], undefined, { exact: true });

    expect(res.status).toBe("published");
    expect(publishes).toEqual([[first]]);
    releaseSaves();
    system.dispose();
  });

  it("does not refuse because the chain grew while it ran", async () => {
    let typeDuringPublish: (() => Promise<PatchId>) | null = null;
    const { system, publishes } = makeSystem({
      onPublish: async () => {
        await typeDuringPublish?.();
      },
    });
    const first = await setTitle(system, "one");
    await saved(system);
    typeDuringPublish = () => setTitle(system, "typed mid-flight");

    const res = await system.publish([first], undefined, { exact: true });

    expect(res.status).toBe("published");
    expect(publishes).toEqual([[first]]);
    system.dispose();
  });

  it("still refuses a module with validation errors", async () => {
    const { c, s } = initVal();
    const publishes: PatchId[][] = [];
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `v${++next}` as PatchId;
      })(),
      savePatches: async ({ patches, parentRef }) => ({
        status: "saved",
        newPatchIds: patches.map((patch) => patch.patchId),
        parentRef,
      }),
      publishPatches: async (request) => {
        publishes.push(request.patchIds);
        return { status: "published" };
      },
    });
    system.host.receive([
      c.define("/v.val.ts", s.object({ title: s.string().minLength(4) }), {
        title: "original",
      }),
    ]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });
    const bad = await edit(system, "/v.val.ts", [
      { op: "replace", path: ["title"], value: "no" },
    ]);
    await saved(system);

    const res = await system.publish([bad], undefined, { exact: true });

    // Relaxing the ordering rules must not relax this one.
    expect(res).toMatchObject({
      status: "refused",
      reason: "validation-errors",
    });
    expect(publishes).toEqual([]);
    system.dispose();
  });

  /**
   * The bug this mode exposes, and the reason `promotePublished` exists.
   *
   * Publishing a prefix used to bake the WHOLE displayed value into the base and
   * then leave the unpublished tail in the chain, so the tail's effect went in
   * twice. Invisible for a `replace`, which is most typing; an array `add`
   * appears twice and nothing says anything.
   */
  it("does not apply a patch typed mid-publish twice", async () => {
    let typeDuringPublish: (() => Promise<PatchId>) | null = null;
    const { system } = makeSystem({
      onPublish: async () => {
        await typeDuringPublish?.();
      },
    });
    const first = await edit(system, "/list.val.ts", [
      { op: "replace", path: ["items", "0"], value: "changed" },
    ]);
    await saved(system);
    typeDuringPublish = () =>
      edit(system, "/list.val.ts", [
        { op: "add", path: ["items", "-"], value: "appended once" },
      ]);

    await system.publish([first], undefined, { exact: true });
    await settle();

    // On screen: base + published + the one still pending.
    const read = await system.sourceStore.get(
      sp('/list.val.ts?p="items"'),
      null,
    );
    if (read.status !== "resolved-head") {
      throw new Error(`expected a value, got ${read.status}`);
    }
    expect(read.data).toEqual(["changed", "appended once"]);

    /*
     * And the BASE, which is where the damage actually is.
     *
     * `sources` is not recomputed by a publish, so a wrong base hides there
     * until something rebuilds — a drop, or the next intake — and then the item
     * appears twice with nothing to explain it. `peekBase` is what a compare
     * view reads, so this is also the visible symptom: the change still pending
     * would otherwise show as already published.
     */
    const base = system.sourceStore.peekBase(sp('/list.val.ts?p="items"'));
    if (base.status !== "ready") {
      throw new Error(`expected a base value, got ${base.status}`);
    }
    expect(base.data).toEqual(["changed"]);
    system.dispose();
  });

  /**
   * The other half of the server change: a patch that cannot be applied is
   * removed rather than refusing the whole commit, so the client has to take it
   * out of the chain and off the screen.
   */
  describe("changes the save could not apply", () => {
    const systemThatRemoves = (removed: PatchId[]) => {
      const { c, s } = initVal();
      const system = createSystem({
        fetchPatches: async () => ({ patches: [] }),
        createPatchId: (() => {
          let next = 0;
          return () => `r${++next}` as PatchId;
        })(),
        savePatches: async ({ patches, parentRef }) => ({
          status: "saved",
          newPatchIds: patches.map((patch) => patch.patchId),
          parentRef,
        }),
        publishPatches: async () => ({
          status: "published",
          removed: removed.map((patchId) => ({
            patchId,
            moduleFilePath: "/a.val.ts" as ModuleFilePath,
            message: "Array index out of bounds",
          })),
        }),
      });
      system.host.receive([
        c.define("/a.val.ts", s.object({ title: s.string() }), {
          title: "published",
        }),
      ]);
      system.stat.receiveStat({ patches: [], baseSha: "sha" });
      return system;
    };

    it("takes the removed change off the screen", async () => {
      const system = systemThatRemoves(["r1" as PatchId]);
      const doomed = await setTitle(system, "will not apply");
      await saved(system);

      await system.publish([doomed], undefined, { exact: true });
      await settle();

      // Dropped, not forgotten-as-published: its effect is NOT in the base, so
      // leaving it on screen would show an edit that exists nowhere.
      expect(await titleOf(system)).toBe("published");
      expect(system.patchStore.allRecords()).toEqual([]);
      system.dispose();
    });

    it("tells the person editing, with the reason", async () => {
      const system = systemThatRemoves(["r1" as PatchId]);
      const doomed = await setTitle(system, "will not apply");
      await saved(system);

      await system.publish([doomed], undefined, { exact: true });

      const [error] = system.status.current().errors;
      expect(error?.message).toBe(
        "An edit could not be applied and was removed.",
      );
      expect(error?.details).toContain("Array index out of bounds");
      system.dispose();
    });

    it("reports it as published, so the caller does not retry it", async () => {
      const system = systemThatRemoves(["r1" as PatchId]);
      const doomed = await setTitle(system, "will not apply");
      await saved(system);

      const res = await system.publish([doomed], undefined, { exact: true });

      // The save succeeded — that is the point of removing rather than
      // refusing. A caller that read this as a failure would try the same batch
      // again forever.
      expect(res.status).toBe("published");
      system.dispose();
    });
  });

  it("leaves the published value on screen, without a flash", async () => {
    const { system } = makeSystem();
    const first = await setTitle(system, "one");
    await saved(system);

    await system.publish([first], undefined, { exact: true });
    await settle();

    // The chain is gone and the base moved under it, so the value must not have
    // gone back to what was published before.
    expect(await titleOf(system)).toBe("one");
    system.dispose();
  });
});
