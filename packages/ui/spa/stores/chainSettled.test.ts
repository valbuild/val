import { initVal, type PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { externalPatch, mfp } from "./testSystem";

/**
 * When the editor has caught up with the server's pending changes.
 *
 * The question a field cannot answer for itself: on the first paint it may be
 * showing PUBLISHED content while a change to it is still in flight. That reads
 * as a stale value, so an editor "fixes" it — and the real value lands
 * underneath the fix a moment later. `chainSettled` is what the shell holds the
 * fields on until.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string() }), {
    title: "published",
  });
};

describe("chainSettled", () => {
  it("is false before any stat: nothing is known yet", () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive([module()]);
    // Not "the chain is empty" — this client has not been told whether there
    // are pending changes at all.
    expect(system.patchStore.chainSettled()).toBe(false);
    system.dispose();
  });

  it("is true once a stat with nothing pending arrives", () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });
    expect(system.patchStore.chainSettled()).toBe(true);
    system.dispose();
  });

  it("is false while an announced patch's ops are still coming", async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const system = createSystem({
      fetchPatches: async (patchIds) => {
        await gate;
        return {
          patches: patchIds.map((patchId) =>
            externalPatch(patchId, "/t.val.ts", [
              { op: "replace", path: ["title"], value: "from the server" },
            ]),
          ),
        };
      },
    });
    system.host.receive([module()]);
    system.stat.receiveStat({
      patches: ["p1" as PatchId],
      baseSha: "sha",
    });

    // Announced, not loaded: this is the window a field would render published
    // content in.
    expect(system.patchStore.chainSettled()).toBe(false);

    release();
    for (let i = 0; i < 50 && !system.patchStore.chainSettled(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(system.patchStore.chainSettled()).toBe(true);
    // And the value is the patched one, which is the whole reason for waiting.
    expect(
      system.sourceStore.peek('/t.val.ts?p="title"' as never),
    ).toMatchObject({ data: "from the server" });
    system.dispose();
  });

  it("does not wait forever on a patch that could not be read", async () => {
    const system = createSystem({
      fetchPatches: async (patchIds) => ({
        patches: [],
        errors: Object.fromEntries(patchIds.map((id) => [id, "no ops"])),
        error: "no ops",
      }),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: ["p1" as PatchId], baseSha: "sha" });

    for (let i = 0; i < 50 && !system.patchStore.chainSettled(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // A failed patch is settled: its effect is never arriving, the failure is
    // reported elsewhere, and holding the whole editor on it would hold it for
    // the rest of the session.
    expect(system.patchStore.chainSettled()).toBe(true);
    system.dispose();
  });

  it("stays true when a local edit is made", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: () => "local-1" as PatchId,
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "typed" },
    ]);
    // A patch this client made is applied the moment it exists — there is
    // nothing to wait for, and dimming the editor as someone types would be
    // absurd.
    expect(system.patchStore.chainSettled()).toBe(true);
    system.dispose();
  });
});

/**
 * `chainSettled()` flips on the APPLY, and the apply announces itself on
 * `patch:head`, not on `patch:chain`.
 *
 * Two stores answer this question — the patch store knows a patch exists, the
 * source store knows whether it landed — and only the second half moves at the
 * end. A reader listening to the chain alone therefore hears the fetch and not
 * the apply, and `useInitialPatchesApplied` is that reader: it holds every field
 * in the Studio dimmed and inert until this is true.
 *
 * It survived only because a repeated `/stat` used to bump the chain
 * unconditionally, which is the wasted project-wide pulse this branch removed.
 * So the last transition has to be observable on its own.
 */
describe("the event that carries the last transition", () => {
  it("announces settling on patch:head", async () => {
    const system = createSystem({
      fetchPatches: async (patchIds) => ({
        patches: patchIds.map((patchId) =>
          externalPatch(patchId, "/t.val.ts", [
            { op: "replace", path: ["title"], value: "from the server" },
          ]),
        ),
      }),
    });
    system.host.receive([module()]);

    const settledOn: string[] = [];
    const record = (type: string) => () => {
      if (system.patchStore.chainSettled()) settledOn.push(type);
    };
    const offChain = system.patchStore.events.on(
      "patch:chain",
      record("chain"),
    );
    const offHead = system.patchStore.events.on("patch:head", record("head"));

    system.stat.receiveStat({
      patches: ["settle-1" as PatchId],
      baseSha: "sha",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(system.patchStore.chainSettled()).toBe(true);
    // The claim: SOMETHING announced it. Named as `head` because that is where
    // the apply is reported from, and a reader has to subscribe to it.
    expect(settledOn).toContain("head");
    offChain();
    offHead();
    system.dispose();
  });
});
