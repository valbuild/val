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
import type { CarriedManifest, FetchManifest } from "./manifestSource";
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
    const { stat, keywords, moduleReads, activity } = setup({
      base: C2,
      chain: [addZ],
    });
    stat();
    await settle();
    expect(keywords()).toEqual(["c", "d", "a", "z"]);
    // The base by its version, and nothing more: the patch on it is the
    // record the patch store fetched for the stat, not a second read.
    expect(moduleReads).toHaveLength(1);
    expect(activity.count("manifest:records-hit")).toBe(1);
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

/**
 * Another editor's keystroke: one patch the stat names and the patch store
 * fetches. What it costs this Studio past that fetch is nothing -- the
 * version the manifest names is the held one with that record on top -- and
 * the manifest itself can come on the stat (`CarriedManifest`).
 */
describe("another editor's keystroke", () => {
  const theirs: PatchRecord = {
    patchId: "theirs" as PatchId,
    moduleFilePath: MODULE,
    patch: [{ op: "add", path: ["keywords", "-"], value: "theirs" }],
    createdAt: "2026-01-01T00:00:04.000Z",
  };

  /** {@link setup}, counting the `GET /manifest`s, and the real one kept. */
  function counting() {
    const fetched: FetchManifest[] = [];
    let asked = 0;
    const server = { base: C0, chain: [] as PatchRecord[] };
    const studio = setup({
      ...server,
      fetchManifest: (real) => {
        fetched.push(real);
        return async (held) => {
          asked++;
          return real(held);
        };
      },
    });
    /** What the server would carry on a stat: its manifest, whole. */
    const carried = async (): Promise<CarriedManifest> => {
      const answer = await fetched[0](null);
      if (answer.kind !== "manifest") throw new Error(answer.kind);
      return { kind: "manifest", answer };
    };
    const statCarrying = (manifest: CarriedManifest, ask = true) => {
      if (ask) studio.system.stat.asked();
      studio.system.stat.receiveStat({
        patches: server.chain.map((record) => record.patchId),
        baseSha: "base",
        manifest,
      });
    };
    return {
      ...studio,
      server,
      carried,
      statCarrying,
      manifestRequests: () => asked,
    };
  }

  test("is the held version and the fetched record: no module is read", async () => {
    const { stat, keywords, moduleReads, activity, server } = counting();
    stat();
    await settle();
    server.chain.push(theirs);
    stat();
    await settle();
    expect(keywords()).toEqual([...C0, "theirs"]);
    expect(moduleReads).toEqual([]);
    expect(activity.count("manifest:records-hit")).toBe(1);
  });

  test("asks for no manifest when the stat carried one", async () => {
    const { stat, keywords, server, carried, statCarrying, manifestRequests } =
      counting();
    stat();
    await settle();
    const before = manifestRequests();
    server.chain.push(theirs);
    statCarrying(await carried());
    await settle();
    expect(keywords()).toEqual([...C0, "theirs"]);
    expect(manifestRequests() - before).toBe(0);
  });

  test("asks for the manifest when the stat's asking was not said", async () => {
    const { stat, keywords, server, carried, statCarrying, manifestRequests } =
      counting();
    stat();
    await settle();
    const before = manifestRequests();
    server.chain.push(theirs);
    // Without the moment it was asked at, nothing can be decided by it.
    statCarrying(await carried(), false);
    await settle();
    expect(keywords()).toEqual([...C0, "theirs"]);
    expect(manifestRequests() - before).toBe(1);
  });

  // A publish answered by the build before it names its old base without
  // the published patches: taken, the page would go back to before them.
  test("asks for the manifest when the stat stopped naming a patch", async () => {
    const { stat, server, carried, statCarrying, manifestRequests } =
      counting();
    server.chain.push(theirs);
    stat();
    await settle();
    const before = manifestRequests();
    server.chain.length = 0;
    statCarrying(await carried());
    await settle();
    expect(manifestRequests() - before).toBe(1);
  });

  test("asks for the manifest when the delta is relative to one it does not hold", async () => {
    const { stat, keywords, server, carried, statCarrying, manifestRequests } =
      counting();
    stat();
    await settle();
    const before = manifestRequests();
    server.chain.push(theirs);
    const whole = await carried();
    if (whole.kind !== "manifest") throw new Error(whole.kind);
    statCarrying({
      kind: "manifest",
      answer: { ...whole.answer, since: 0, modules: {} },
      sinceTag: "a manifest this Studio never held",
    });
    await settle();
    expect(keywords()).toEqual([...C0, "theirs"]);
    expect(manifestRequests() - before).toBe(1);
  });
});
