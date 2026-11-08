import {
  initVal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "./createSystem";
import { RecordingActivity } from "./activity";
import { createFakeManifest } from "./testManifest";
import type { FetchManifest } from "./manifestSource";
import type { PatchRecord } from "./types";

/**
 * What a field shows is the module at the version the server's manifest
 * names, with this Studio's own edits on top (`ManifestSource`, phase 7 of
 * `docs/plans/one-content-model.md`). These pin what `BaseAlignment` and its
 * `baseAndChain.test.ts` pinned, the way it is done now: whatever base the
 * server is on, what shows is the server's content plus the pending edits --
 * never an edit missing, never one applied twice -- and what it costs.
 *
 * The chain is array ops on purpose. A `replace` applied twice or skipped
 * once can look right; a `move` or a `remove` cannot.
 *
 *   C0  the seed:   [a, b, c, d]   <- the bundle this Studio loaded
 *   C1  published:  move a to the end   -> [b, c, d, a]
 *   C2  published:  remove index 0      -> [c, d, a]
 *   --  pending:    add "z" at the end  -> [c, d, a, z]   <- what must show
 */

const MODULE = "/lists.val.ts" as ModuleFilePath;
const KEYWORDS = '/lists.val.ts?p="keywords"' as SourcePath;
const C0 = ["a", "b", "c", "d"];
const C2 = ["c", "d", "a"];

const moveAToTheEnd: PatchRecord = {
  patchId: "c1" as PatchId,
  moduleFilePath: MODULE,
  patch: [{ op: "move", from: ["keywords", "0"], path: ["keywords", "3"] }],
  createdAt: "2026-01-01T00:00:00.000Z",
};
const removeTheFirst: PatchRecord = {
  patchId: "c2" as PatchId,
  moduleFilePath: MODULE,
  patch: [{ op: "remove", path: ["keywords", "0"] }],
  createdAt: "2026-01-01T00:00:01.000Z",
};
const addZ: PatchRecord = {
  patchId: "pending" as PatchId,
  moduleFilePath: MODULE,
  patch: [{ op: "add", path: ["keywords", "-"], value: "z" }],
  createdAt: "2026-01-01T00:00:02.000Z",
};

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/**
 * A Studio with the C0 bundle, against a server whose base and chain the
 * test sets, saves included.
 */
function setup(server: {
  base: string[];
  chain: PatchRecord[];
  fetchManifest?: (real: FetchManifest) => FetchManifest;
}) {
  const { c, s } = initVal();
  const module = c.define(MODULE, s.object({ keywords: s.array(s.string()) }), {
    keywords: C0,
  });
  let systemRef: System | null = null;
  const fake = createFakeManifest({
    bases: () =>
      new Map([
        [
          MODULE,
          {
            source: { keywords: server.base } satisfies Json,
            schema: systemRef?.schemaStore.get(MODULE),
          },
        ],
      ]),
    chain: () => server.chain,
  });
  const moduleReads: { v?: string; have?: string }[] = [];
  let seq = 0;
  const activity = new RecordingActivity(() => ++seq);
  const system = createSystem({
    activity,
    fetchManifest:
      server.fetchManifest?.(fake.fetchManifest) ?? fake.fetchManifest,
    fetchModule: (path, query) => {
      moduleReads.push(query);
      return fake.fetchModule(path, query);
    },
    fetchPatches: async (patchIds) => ({
      patches: server.chain.filter((record) =>
        patchIds.includes(record.patchId),
      ),
    }),
    createPatchId: (() => {
      let next = 0;
      return () => `local-${++next}` as PatchId;
    })(),
    savePatches: async ({ patches, parentRef }) => {
      for (const patch of patches) {
        server.chain.push({
          patchId: patch.patchId,
          moduleFilePath: patch.path,
          patch: patch.patch,
          createdAt: "2026-01-01T00:00:03.000Z",
        });
      }
      return {
        status: "saved",
        newPatchIds: patches.map((patch) => patch.patchId),
        parentRef,
      };
    },
  });
  systemRef = system;
  system.host.receive([module]);
  const stat = () =>
    system.stat.receiveStat({
      patches: server.chain.map((record) => record.patchId),
      baseSha: "base",
    });
  const keywords = () => {
    const peeked = system.sourceStore.peek(KEYWORDS);
    return peeked.status === "ready" ? peeked.data : peeked;
  };
  return { system, stat, keywords, moduleReads, activity, module };
}

describe("the Studio on the server's version, whatever base it is on", () => {
  test("a server on the bundle's base reads the manifest and no module", async () => {
    const { stat, keywords, moduleReads } = setup({ base: C0, chain: [] });
    stat();
    await settle();
    expect(keywords()).toEqual(C0);
    expect(moduleReads).toEqual([]);
  });

  test("a base the bundle was not built with is one read, and the pending edit goes on it", async () => {
    const { stat, keywords, moduleReads } = setup({
      base: C2,
      chain: [addZ],
    });
    stat();
    await settle();
    expect(keywords()).toEqual(["c", "d", "a", "z"]);
    // The base by its version, then the patches from it.
    expect(moduleReads).toHaveLength(2);
    expect(moduleReads[1]?.have).toBe(moduleReads[0]?.v);
  });

  test("published patches still in the chain on the old base are applied once", async () => {
    const { stat, keywords } = setup({
      base: C0,
      chain: [moveAToTheEnd, removeTheFirst, addZ],
    });
    stat();
    await settle();
    expect(keywords()).toEqual(["c", "d", "a", "z"]);
  });

  test("the base moving under the chain (a deploy) leaves the content as it was", async () => {
    const server = { base: C0, chain: [moveAToTheEnd, removeTheFirst, addZ] };
    const { stat, keywords } = setup(server);
    stat();
    await settle();
    // The deploy: the published two are in the base now, out of the chain.
    server.base = C2;
    server.chain = [addZ];
    stat();
    await settle();
    expect(keywords()).toEqual(["c", "d", "a", "z"]);
  });

  test("a re-intake puts the server's base back in the same turn", async () => {
    const { system, stat, keywords, module } = setup({
      base: C2,
      chain: [],
    });
    stat();
    await settle();
    expect(keywords()).toEqual(C2);
    // HMR hands the bundle's source in again: never on screen.
    system.host.receive([module]);
    expect(keywords()).toEqual(C2);
  });

  test("an edit this Studio made is not read back when the server confirms it", async () => {
    const { system, stat, keywords, moduleReads, activity } = setup({
      base: C0,
      chain: [],
    });
    stat();
    await settle();
    await system.patchStore.createPatch(MODULE, [
      { op: "add", path: ["keywords", "-"], value: "typed" },
    ]);
    await system.patchSync.flush();
    stat();
    await settle();
    expect(keywords()).toEqual([...C0, "typed"]);
    expect(moduleReads).toEqual([]);
    expect(activity.count("manifest:memory-hit")).toBe(1);
  });

  test("a previous build's manifest is not moved to", async () => {
    const { stat, keywords, moduleReads } = setup({
      base: C2,
      chain: [],
      fetchManifest: () => async () => ({ kind: "superseded" }),
    });
    stat();
    await settle();
    // The bundle's, as before: nothing that build named was read.
    expect(keywords()).toEqual(C0);
    expect(moduleReads).toEqual([]);
  });
});
