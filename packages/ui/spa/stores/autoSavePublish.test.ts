import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, takeNamedPrefix, type System } from "./createSystem";
import type { PublishPatches } from "./PublishSeam";

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
/**
 * The one entry's content, shared by the module definition and the fetch seam
 * so they cannot drift — a `.jsonValues()` entry is served by `GET /json`, not
 * read out of the module.
 */
const BLOG_A = { title: "Alpha", body: "First body" };

const project = () => {
  const { c, s } = initVal();
  return [
    c.define("/a.val.ts", s.object({ title: s.string() }), {
      title: "published",
    }),
    c.define("/list.val.ts", s.object({ items: s.array(s.string()) }), {
      items: ["one"],
    }),
    /*
     * A `.jsonValues()` record, because it is the module shape where the two
     * realms come apart: source keeps an opaque marker and the entry content
     * lives beside it, in `jsonEntries` for the live realm and
     * `baseJsonEntries` for the base one.
     */
    c.define(
      "/blogs.val.ts",
      s.record(s.object({ title: s.string(), body: s.string() })).jsonValues(),
      {
        "/a": c.json(() => Promise.resolve({ default: { ...BLOG_A } })),
      },
    ),
  ];
};

function makeSystem(options?: {
  onPublish?: (patchIds: PatchId[]) => Promise<void>;
  holdSaves?: boolean;
  publishOutcome?: Awaited<ReturnType<PublishPatches>>;
}) {
  const publishes: PatchId[][] = [];
  const fetched: PatchId[][] = [];
  const held: (() => void)[] = [];
  const modules = project();
  const system = createSystem({
    fetchPatches: async (patchIds) => {
      fetched.push([...patchIds]);
      return { patches: [] };
    },
    fetchJsonEntry: async (moduleFilePath, key) => {
      // Genuinely async, like the real `GET /json`, so nothing can come to
      // depend on an entry being there synchronously.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (moduleFilePath !== "/blogs.val.ts" || key !== "/a") {
        return { status: "error", message: `no entry '${key}'` };
      }
      return { status: "ok", content: { ...BLOG_A } };
    },
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
      return options?.publishOutcome ?? { status: "published" };
    },
  });
  system.host.receive(modules);
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return {
    system,
    publishes,
    fetched,
    releaseSaves: () => held.forEach((r) => r()),
  };
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
   * The same partial publish, on the module shape where the base is not one
   * object.
   *
   * A `.jsonValues()` module keeps `{_type:"json"}` markers in source and the
   * entry content beside it, and every apply goes through the SUBSTITUTED value
   * — stitch the content in, apply, split it back out. `promotePublished` did
   * not: it applied the published prefix to the raw base, where a patch at
   * `["/a", "title"]` has no `title` to replace. The rebuild failed, the chain
   * was trimmed anyway, and the published edit ended up in neither base nor
   * chain — so the next rebuild showed the value as it was BEFORE it shipped,
   * with the change sitting on disk.
   */
  it("moves the base of a jsonValues module when a prefix publishes", async () => {
    let typeDuringPublish: (() => Promise<PatchId>) | null = null;
    const { system } = makeSystem({
      onPublish: async () => {
        await typeDuringPublish?.();
      },
    });
    // Reading inside the entry is what loads it — into both realms.
    const loaded = await system.sourceStore.get(
      sp('/blogs.val.ts?p="/a"."title"'),
      null,
    );
    expect(loaded.status).toBe("resolved-head");

    const first = await edit(system, "/blogs.val.ts", [
      { op: "replace", path: ["/a", "title"], value: "Published" },
    ]);
    await saved(system);
    typeDuringPublish = () =>
      edit(system, "/blogs.val.ts", [
        { op: "replace", path: ["/a", "body"], value: "typed mid-save" },
      ]);

    await system.publish([first], undefined, { exact: true });
    await settle();

    /*
     * The published edit is IN the base — which for this module means in
     * `baseJsonEntries`, since that is where the entry's content lives.
     */
    const base = system.sourceStore.peekBase(
      sp('/blogs.val.ts?p="/a"."title"'),
    );
    if (base.status !== "ready") {
      throw new Error(`expected a base value, got ${base.status}`);
    }
    expect(base.data).toEqual("Published");

    // And the change still pending is NOT, so a compare still offers it.
    const pendingInBase = system.sourceStore.peekBase(
      sp('/blogs.val.ts?p="/a"."body"'),
    );
    if (pendingInBase.status !== "ready") {
      throw new Error(`expected a base value, got ${pendingInBase.status}`);
    }
    expect(pendingInBase.data).toEqual("First body");
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

  /**
   * The loop the timer used to spin in.
   *
   * A 400 that blames no particular patch — "Failed to save files", a module
   * that could not be formatted — reaches the client as an empty error map.
   * Recording it bumped the chain, and the auto-save batch is memoised on the
   * chain, so the debounce re-ran with an identical batch and published it
   * again. One `POST /save` and one toast every 700 ms, with nobody typing.
   *
   * Nothing was recorded, so nothing changed, so nothing should be woken. The
   * effect itself also refuses to re-send an identical batch after a failure —
   * this is the half that can be pinned here, and it is the one that fires for
   * the errors nobody can act on.
   */
  it("does not move the chain when a failed publish blames no patch", async () => {
    const { system } = makeSystem({
      publishOutcome: {
        status: "patch-errors",
        message: "Failed to save files",
        errors: {},
      },
    });
    const first = await setTitle(system, "typed");
    await saved(system);
    const before = system.patchStore.chainVersion();

    const res = await system.publish([first], undefined, { exact: true });
    await settle();

    expect(res.status).toBe("failed");
    expect(system.patchStore.chainVersion()).toBe(before);
    system.dispose();
  });

  describe("the whole-project pass", () => {
    /**
     * The per-save gate only checks the modules a batch touched, which is what
     * keeps typing cheap. A module nobody has opened has never been checked at
     * all, so once the chain is empty is the moment to check the rest.
     */
    it("validates every loaded module, not just the edited one", async () => {
      const { system } = makeSystem();
      const seen: string[] = [];
      const original = system.validationStore.validate.bind(
        system.validationStore,
      );
      system.validationStore.validate = async (moduleFilePath) => {
        seen.push(moduleFilePath);
        return original(moduleFilePath);
      };

      await system.validateEverything();

      expect(seen.sort()).toEqual([
        "/a.val.ts",
        "/blogs.val.ts",
        "/list.val.ts",
      ]);
      system.dispose();
    });

    it("says when it starts and when it stops", async () => {
      const { system } = makeSystem();
      const running: boolean[] = [];
      system.validationStore.events.on("validation:full-pass", (event) => {
        running.push(event.running);
      });

      await system.validateEverything();

      // Both edges, in order: a spinner that is never taken down is worse than
      // no spinner.
      expect(running).toEqual([true, false]);
      system.dispose();
    });

    it("does not start a second pass on top of one already running", async () => {
      const { system } = makeSystem();
      let starts = 0;
      system.validationStore.events.on("validation:full-pass", (event) => {
        if (event.running) starts++;
      });

      await Promise.all([
        system.validateEverything(),
        system.validateEverything(),
      ]);

      // The answer the first one produces is the answer the second one wanted.
      expect(starts).toBe(1);
      system.dispose();
    });
  });
});

/**
 * The stat that arrives right after `/save`, naming what `/save` just deleted.
 *
 * `/stat` long polls in `fs` mode: its patch list is read when the poll opens
 * and the response is sent when a file changes — and the file that changes is
 * the one the publish just wrote. So the answer routinely names the patches the
 * publish committed and removed, a whole polling interval after they stopped
 * existing.
 *
 * With auto-save on, that is every pause in typing, which is how this reached a
 * user as "3 unpublished changes could not be loaded." for three changes that
 * had been published a moment earlier. `ValOpsFS.getStat` now reads again before
 * answering, so the stale list is not produced in the first place; this is the
 * studio holding up its end regardless, because no snapshot protocol can promise
 * the list was not overtaken.
 */
describe("a stat older than the publish it follows", () => {
  it("ignores the patches it has already published", async () => {
    const { system, fetched } = makeSystem();
    const first = await setTitle(system, "one");
    await saved(system);
    expect(await system.publish([first], undefined, { exact: true })).toEqual({
      status: "published",
      patchIds: [first],
    });

    system.stat.receiveStat({ patches: [first], baseSha: "sha" });
    await settle();

    // Not reported, because nothing is wrong: the change is published and its
    // effect is in the base.
    expect(system.status.current().errors).toEqual([]);
    // Not fetched either. Asking for it is what produces the empty answer that
    // used to be read as the server contradicting itself.
    expect(fetched).toEqual([]);
    // And not back in the chain: re-adding it moves the head and unsettles it,
    // which stops fields rendering while it is "on its way".
    expect(system.patchStore.allRecords()).toEqual([]);
    expect(await titleOf(system)).toBe("one");
    system.dispose();
  });

  /**
   * The value is the point. A published patch's effect lives in the base now, so
   * anything that puts its id back in the chain has to be wrong in one direction
   * or the other: dropped, and the field reverts; applied, and it lands twice.
   */
  it("does not apply a published patch a second time", async () => {
    const { system } = makeSystem();
    const first = await edit(system, "/list.val.ts", [
      { op: "add", path: ["items", "-"], value: "two" },
    ]);
    await saved(system);
    await system.publish([first], undefined, { exact: true });

    system.stat.receiveStat({ patches: [first], baseSha: "sha" });
    await settle();

    const read = await system.sourceStore.get(
      sp('/list.val.ts?p="items"'),
      null,
    );
    if (read.status !== "resolved-head") {
      throw new Error(`expected a value, got ${read.status}`);
    }
    expect(read.data).toEqual(["one", "two"]);
    system.dispose();
  });
});

/**
 * What the canvas has to be told about after a publish.
 *
 * The relay into a canvas document carries changes; a freshly loaded document is
 * caught up with a snapshot of "every module the editor knows a newer value for
 * than the page might". That used to mean modules with a PENDING patch, which is
 * the set a publish empties — so the document loaded by the reload the publish
 * itself caused was caught up with nothing, told that was all of it, and left
 * rendering whatever the server gave it. Right after a publish that can be the
 * content from before it, and nothing moved again until someone typed.
 */
describe("modules the editor stays authoritative about", () => {
  it("names a module it published into, after the chain has emptied", async () => {
    const { system } = makeSystem();
    const first = await setTitle(system, "one");
    await saved(system);
    await system.publish([first], undefined, { exact: true });

    // The chain is empty: nothing pending says this module was touched.
    expect(system.patchStore.allRecords()).toEqual([]);
    expect(system.patchStore.publishedModules()).toEqual(["/a.val.ts"]);
    system.dispose();
  });

  it("says nothing about a module that was only saved", async () => {
    const { system } = makeSystem();
    await setTitle(system, "one");
    await saved(system);

    // Saved is not published: the patch is still in the chain, so the pending
    // set already names this module and there is nothing to add.
    expect(system.patchStore.publishedModules()).toEqual([]);
    system.dispose();
  });

  it("names every module a publish spanned", async () => {
    const { system } = makeSystem();
    const first = await setTitle(system, "one");
    const second = await edit(system, "/list.val.ts", [
      { op: "add", path: ["items", "-"], value: "two" },
    ]);
    await saved(system);
    await system.publish([first, second], undefined, { exact: true });

    expect(system.patchStore.publishedModules().sort()).toEqual([
      "/a.val.ts",
      "/list.val.ts",
    ]);
    system.dispose();
  });

  /**
   * Not emptied by anything, and that is the point: re-sending a value the page
   * already has changes nothing on screen, while forgetting one too early is a
   * stale canvas with no way back.
   */
  it("keeps naming it across a later publish", async () => {
    const { system } = makeSystem();
    const first = await setTitle(system, "one");
    await saved(system);
    await system.publish([first], undefined, { exact: true });
    const second = await edit(system, "/list.val.ts", [
      { op: "add", path: ["items", "-"], value: "two" },
    ]);
    await saved(system);
    await system.publish([second], undefined, { exact: true });

    expect(system.patchStore.publishedModules().sort()).toEqual([
      "/a.val.ts",
      "/list.val.ts",
    ]);
    system.dispose();
  });
});
