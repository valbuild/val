import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { createSystem, type System } from "./createSystem";
import type { PublishOutcome } from "./PublishSeam";
import { mfp } from "./testSystem";

/**
 * The gate between "Save" and the content actually being committed.
 *
 * Validation running before a publish is not new. What is checked here is the
 * harder property: the patches that were validated are the patches that get
 * published. Three ways that used to come apart, all of them widened by a field
 * writing on a pause in typing rather than on every keystroke:
 *
 * - The caller's id list comes from the SERVER's chain, so an edit still only
 *   local is missing from it — while the validation, which reads local source,
 *   is about a document that includes it. Publishing that list ships the project
 *   without the last thing the user typed.
 * - The reverse: a local patch that FIXES an error makes validation pass, and a
 *   publish of the server's shorter list then commits the broken value.
 * - Validation is asynchronous, so an edit can land while it runs.
 */
const project = () => {
  const { c, s } = initVal();
  return [
    c.define("/a.val.ts", s.object({ title: s.string().minLength(4) }), {
      title: "original",
    }),
  ];
};

function makeSystem(options?: {
  outcome?: PublishOutcome;
  saveFails?: boolean;
}) {
  const publishes: { patchIds: PatchId[] }[] = [];
  const saved: PatchId[][] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `gate-${++next}` as PatchId;
    })(),
    // Short, so a test about the refusal is not a test about the wait.
    saveFlushTimeoutMs: 50,
    savePatches: async ({ patches, parentRef }) => {
      if (options?.saveFails) {
        return { status: "network-error", message: "offline" };
      }
      const patchIds = patches.map((patch) => patch.patchId);
      saved.push(patchIds);
      return { status: "saved", newPatchIds: patchIds, parentRef };
    },
    publishPatches: async (request) => {
      publishes.push({ patchIds: request.patchIds });
      return options?.outcome ?? { status: "published" };
    },
  });
  system.host.receive(project());
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  return { system, publishes, saved };
}

const edit = (system: System, value: string) =>
  system.patchStore.createPatch("/a.val.ts" as ModuleFilePath, [
    { op: "replace", path: ["title"], value },
  ]);

describe("the publish gate", () => {
  it("publishes the edit that had not been saved yet", async () => {
    const { system, publishes } = makeSystem();
    // Two edits, neither of which the caller below knows about: this is the
    // studio's own situation, where the id list comes from the server.
    await edit(system, "first value");
    const second = await edit(system, "second value");
    const secondId = second.status === "created" ? second.record.patchId : null;

    // The caller asks with an EMPTY list, as it would having read the server's
    // chain before either write landed.
    const res = await system.publish([]);

    expect(res).toMatchObject({ status: "published" });
    // Everything typed, not what the caller happened to know about.
    expect(publishes).toHaveLength(1);
    expect(publishes[0].patchIds).toContain(secondId);
    expect(publishes[0].patchIds).toHaveLength(2);
    system.dispose();
  });

  it("refuses rather than publish a chain it could not finish saving", async () => {
    const { system, publishes } = makeSystem({ saveFails: true });
    const first = await edit(system, "unsaved value");
    const firstId = first.status === "created" ? first.record.patchId : null;

    const res = await system.publish([firstId as PatchId]);

    expect(res).toMatchObject({ status: "refused", reason: "unsaved-changes" });
    // Nothing published: a chain missing its newest patch is worse than no
    // publish, because the newest patch is what the user is looking at.
    expect(publishes).toEqual([]);
    system.dispose();
  });

  /**
   * A save that is SLOW is not a save that FAILED.
   *
   * The flush is bounded because a failing save retries for as long as the
   * network is down. A save still in flight has not failed: it is the edit the
   * user just made, on its way. Timing it out refused the publish with "your
   * latest changes could not be saved. Check the connection" — about a change
   * the server accepted a moment later, with the status bar saying "All changes
   * saved" beside it.
   *
   * What made it slow in the case that found it was the first publish itself:
   * in `fs` mode a publish rewrites `.val.ts` files, `next dev` recompiles, and
   * the next `PUT /patches` waits on the rebuild — 5.4s against a 5s bound, in
   * `e2e/studio-ui.spec.ts`'s save-then-restore. An editor saving twice in a row
   * hits the same thing.
   */
  it("waits for a save still in flight that has not failed", async () => {
    const publishes: { patchIds: PatchId[] }[] = [];
    let answer: (() => void) | undefined;
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `slow-${++next}` as PatchId;
      })(),
      // The DEFAULT wait, deliberately: the bug was the default.
      savePatches: async ({ patches, parentRef }) => {
        // Answered well past the bound, and successfully.
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return {
          status: "saved",
          newPatchIds: patches.map((patch) => patch.patchId),
          parentRef,
        };
      },
      publishPatches: async (request) => {
        publishes.push({ patchIds: request.patchIds });
        return { status: "published" };
      },
    });
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    const created = await edit(system, "a slow value");
    const patchId =
      created.status === "created" ? created.record.patchId : null;
    jest.useFakeTimers();
    try {
      let settled = false;
      const running = system.publish([]).finally(() => {
        settled = true;
      });
      // The 5.4s the restore save took in CI, past the 5s the wait used to be.
      await jest.advanceTimersByTimeAsync(5_400);
      expect(settled).toBe(false);
      answer?.();
      for (let i = 0; i < 100 && !settled; i++) {
        await jest.advanceTimersByTimeAsync(10);
      }

      expect(await running).toMatchObject({ status: "published" });
      expect(publishes).toEqual([{ patchIds: [patchId] }]);
    } finally {
      jest.useRealTimers();
      system.dispose();
    }
  });

  /**
   * And the other half of the bound: once the save is STUCK, there is nothing
   * to wait for. The sync says so at `SAVE_STUCK_AFTER_ATTEMPTS`, the same
   * moment it tells the editor, and the publish refuses then rather than at the
   * end of a timer.
   */
  it("refuses as soon as the save in flight is stuck", async () => {
    const publishes: { patchIds: PatchId[] }[] = [];
    let attempts = 0;
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `fails-${++next}` as PatchId;
      })(),
      // Long, so a refusal inside the test's own timeout can only have come
      // from the failure and not from the backstop.
      saveFlushTimeoutMs: 60_000,
      savePatches: async () => {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { status: "network-error", message: "offline" };
      },
      publishPatches: async (request) => {
        publishes.push({ patchIds: request.patchIds });
        return { status: "published" };
      },
    });
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    await edit(system, "an unsaveable value");
    const res = await system.publish([]);

    expect(res).toMatchObject({ status: "refused", reason: "unsaved-changes" });
    expect(attempts).toBeGreaterThan(0);
    expect(publishes).toEqual([]);
    system.dispose();
  });

  /**
   * But one failure is not stuck. A first attempt failing is usually nothing —
   * the API route recompiling, a proxy reconnecting — and the retry absorbs it.
   * Refusing on it would refuse a publish the retry was about to make possible.
   */
  it("still publishes when a save fails once and the retry lands", async () => {
    const publishes: { patchIds: PatchId[] }[] = [];
    let attempts = 0;
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `blip-${++next}` as PatchId;
      })(),
      saveFlushTimeoutMs: 60_000,
      savePatches: async ({ patches, parentRef }) => {
        attempts += 1;
        if (attempts === 1) {
          return { status: "network-error", message: "recompiling" };
        }
        return {
          status: "saved",
          newPatchIds: patches.map((patch) => patch.patchId),
          parentRef,
        };
      },
      publishPatches: async (request) => {
        publishes.push({ patchIds: request.patchIds });
        return { status: "published" };
      },
    });
    system.host.receive(project());
    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    const created = await edit(system, "a value saved second time");
    const patchId =
      created.status === "created" ? created.record.patchId : null;
    const res = await system.publish([]);

    expect(res).toMatchObject({ status: "published" });
    expect(attempts).toBe(2);
    expect(publishes).toEqual([{ patchIds: [patchId] }]);
    system.dispose();
  });

  /**
   * The dangerous direction, and the reason the gate publishes the chain rather
   * than the caller's list.
   *
   * The invalid value is on the server; the fix is still local. Validating local
   * source says "fine", and publishing only the server's id would commit
   * "Foo" — invalid content, shipped by a gate that had just approved it.
   */
  it("does not publish a broken patch because a later one fixes it", async () => {
    const { system, publishes } = makeSystem();
    const broken = await edit(system, "Foo");
    const brokenId = broken.status === "created" ? broken.record.patchId : null;
    await system.patchSync.flush();
    // The fix, made after the first patch reached the server.
    await edit(system, "Foobar");

    const res = await system.publish([brokenId as PatchId]);

    expect(res).toMatchObject({ status: "published" });
    // Both, so what is committed is the value that was validated.
    expect(publishes[0].patchIds).toHaveLength(2);
    system.dispose();
  });

  it("still refuses when the whole chain is invalid", async () => {
    const { system, publishes } = makeSystem();
    const broken = await edit(system, "Foo");
    const brokenId = broken.status === "created" ? broken.record.patchId : null;

    const res = await system.publish([brokenId as PatchId]);

    expect(res).toMatchObject({
      status: "refused",
      reason: "validation-errors",
      modules: [mfp("/a.val.ts")],
    });
    expect(publishes).toEqual([]);
    system.dispose();
  });

  /**
   * An edit landing while the gate validates means the answer is about a
   * document that no longer exists.
   */
  it("refuses when the chain moves while it is validating", async () => {
    const { c, s } = initVal();
    const publishes: { patchIds: PatchId[] }[] = [];
    /** Released once an edit has been slipped in behind the validation. */
    const waiting: (() => void)[] = [];
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `race-${++next}` as PatchId;
      })(),
      saveFlushTimeoutMs: 50,
      savePatches: async ({ patches, parentRef }) => ({
        status: "saved",
        newPatchIds: patches.map((patch) => patch.patchId),
        parentRef,
      }),
      publishPatches: async (request) => {
        publishes.push({ patchIds: request.patchIds });
        return { status: "published" };
      },
      schemaValidation: {
        async validate() {
          await new Promise<void>((resolve) => waiting.push(resolve));
          return false;
        },
      },
    });
    system.host.receive([
      c.define("/a.val.ts", s.object({ title: s.string() }), {
        title: "original",
      }),
    ]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    const first = await edit(system, "first");
    const firstId = first.status === "created" ? first.record.patchId : null;
    const running = system.publish([firstId as PatchId]);

    for (let i = 0; i < 100 && waiting.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // The user types again while the gate is inside validation.
    await edit(system, "typed during the gate");

    /**
     * Gates released as they appear, not once.
     *
     * `ValidationStore.run` recomputes when its source moved under it, so the
     * edit above produces a second pass through the bridge — and a test that
     * releases a single gate then waits forever on the next one.
     */
    const drain = setInterval(() => {
      waiting.shift()?.();
    }, 1);
    try {
      expect(await running).toMatchObject({
        status: "refused",
        reason: "chain-moved",
      });
    } finally {
      clearInterval(drain);
    }
    expect(publishes).toEqual([]);
    system.dispose();
  });
});
