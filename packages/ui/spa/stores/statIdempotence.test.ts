import { initVal, type PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { externalPatch } from "./testSystem";

/**
 * A `/stat` that announces the chain we already hold must announce nothing.
 *
 * `patch:chain` is a project-wide wake-up: `filePatchIds()` rebuilds and hands
 * every media field a new map, every `useChainVersion` reader re-renders and
 * walks the chain, and `createSystem` reschedules the pending-module validation
 * pass. That is the right cost for a chain that moved and pure waste for one
 * that did not.
 *
 * And it is not a rare case. `/stat` long polls in `fs` mode on a watcher over
 * `.val/patches`, so it answers on every write AND again on every polling
 * interval — so before this, an idle Studio with pending changes re-rendered
 * every mounted field every twenty seconds, for no news.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define("/t.val.ts", s.object({ title: s.string() }), {
    title: "published",
  });
};

function countChainEvents(system: ReturnType<typeof createSystem>) {
  let count = 0;
  const off = system.patchStore.events.on("patch:chain", () => {
    count++;
  });
  return { read: () => count, off };
}

describe("a stat that changes nothing", () => {
  it("announces the first one even when it names no patches", () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive([module()]);
    const chain = countChainEvents(system);

    system.stat.receiveStat({ patches: [], baseSha: "sha" });

    // The first stat is what makes `chainSettled()` true, and the shell holds
    // every field inert until it is. An empty first stat against an empty chain
    // moves nothing in `ordered` and still has to be told.
    expect(chain.read()).toBe(1);
    expect(system.patchStore.chainSettled()).toBe(true);
    chain.off();
    system.dispose();
  });

  it("says nothing when a later stat repeats the same chain", async () => {
    const patchId = "p1" as PatchId;
    const system = createSystem({
      fetchPatches: async (ids) => ({
        patches: ids.map((id) =>
          externalPatch(id, "/t.val.ts", [
            { op: "replace", path: ["title"], value: "from the server" },
          ]),
        ),
      }),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: [patchId], baseSha: "sha" });
    // Let the fetch and the apply settle, so the chain is at rest.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const chain = countChainEvents(system);
    system.stat.receiveStat({ patches: [patchId], baseSha: "sha" });
    system.stat.receiveStat({ patches: [patchId], baseSha: "sha" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chain.read()).toBe(0);
    chain.off();
    system.dispose();
  });

  it("still announces a chain that gained a patch", async () => {
    const system = createSystem({
      fetchPatches: async (ids) => ({
        patches: ids.map((id) =>
          externalPatch(id, "/t.val.ts", [
            { op: "replace", path: ["title"], value: id },
          ]),
        ),
      }),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({ patches: ["p1" as PatchId], baseSha: "sha" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const chain = countChainEvents(system);
    system.stat.receiveStat({
      patches: ["p1" as PatchId, "p2" as PatchId],
      baseSha: "sha",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chain.read()).toBeGreaterThan(0);
    chain.off();
    system.dispose();
  });

  it("still announces a REORDER of the same ids", async () => {
    const system = createSystem({
      fetchPatches: async (ids) => ({
        patches: ids.map((id) =>
          externalPatch(id, "/t.val.ts", [
            { op: "replace", path: ["title"], value: id },
          ]),
        ),
      }),
    });
    system.host.receive([module()]);
    system.stat.receiveStat({
      patches: ["p1" as PatchId, "p2" as PatchId],
      baseSha: "sha",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const chain = countChainEvents(system);
    // Same ids, different order. Stat is the authority on ORDER, so this is a
    // real change — which is why the comparison is position-wise and not a set
    // test.
    system.stat.receiveStat({
      patches: ["p2" as PatchId, "p1" as PatchId],
      baseSha: "sha",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chain.read()).toBeGreaterThan(0);
    chain.off();
    system.dispose();
  });
});
