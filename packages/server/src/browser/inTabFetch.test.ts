import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import { createValClient } from "@valbuild/shared/internal";
import { createInTabValFetch } from "./inTabFetch";
import {
  DEMO_PATCHES_STORAGE_KEY,
  SessionStoragePatchStore,
  type PatchStorage,
} from "./sessionStoragePatchStore";

/**
 * The demo's whole server path, with only the network removed: the Studio's
 * own client, the router, `ValServer` in memory mode, and the store that keeps
 * edits for the life of a tab.
 *
 * The import guard proves this can be BUNDLED for a browser. This proves it
 * still WORKS -- a change can keep the first and break the second.
 */

const { s, c, config } = initVal({});

const valModules: ValModules = {
  config,
  modules: [
    {
      def: () =>
        Promise.resolve({
          default: c.define(
            "/content/home.val.ts",
            s.object({ title: s.string() }),
            { title: "Hello" },
          ),
        }),
    },
  ],
};

function mapStorage(): PatchStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function clientFor(storage: PatchStorage) {
  const inTab = createInTabValFetch(valModules, {
    config,
    patchStore: new SessionStoragePatchStore(storage),
  });
  return createValClient("/api/val", null, { fetch: inTab });
}

async function stat(client: ReturnType<typeof clientFor>) {
  const res = await client("/stat", "POST", { body: null });
  if (res.status !== 200 || !("baseSha" in res.json)) {
    throw new Error(
      `/stat answered ${res.status}: ${JSON.stringify(res.json)}`,
    );
  }
  return res.json;
}

const HOME = "/content/home.val.ts" as ModuleFilePath;

const titlePatch = (title: string) => [
  { op: "replace" as const, path: ["title"], value: title },
];

describe("the in-tab server", () => {
  test("answers /stat as a local, authenticated-without-asking server", async () => {
    const client = clientFor(mapStorage());
    const answer = await stat(client);
    expect("mode" in answer && answer.mode).toBe("fs");
    expect(answer.patches).toEqual([]);
  });

  test("answers /profiles with nobody, not an error, without a project", async () => {
    const client = clientFor(mapStorage());
    const res = await client("/profiles", "GET", {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ profiles: [] });
  });

  test("saves an edit on the head and serves it back", async () => {
    const client = clientFor(mapStorage());
    const { baseSha } = await stat(client);
    const patchId = "00000000-0000-4000-8000-000000000001" as PatchId;
    const saved = await client("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: baseSha },
        patches: [{ path: HOME, patchId, patch: titlePatch("Hi") }],
      },
    });
    expect(saved.status).toBe(200);

    expect((await stat(client)).patches).toEqual([patchId]);
    const fetched = await client("/patches", "GET", {
      query: { patch_id: [patchId], exclude_patch_ops: false },
    });
    expect(fetched.status).toBe(200);
    expect(JSON.stringify(fetched.json)).toContain('"Hi"');
  });

  test("puts every save last, whatever parent it names, as fs mode does", async () => {
    // Memory mode, like fs mode, decides the order itself: the store's order
    // IS the chain (see `ValOpsMemory.saveSourceFilePatch`). So a save naming
    // a parent that is no longer the head is appended, not refused.
    const client = clientFor(mapStorage());
    const { baseSha } = await stat(client);
    const first = "00000000-0000-4000-8000-000000000001" as PatchId;
    const second = "00000000-0000-4000-8000-000000000002" as PatchId;
    for (const [patchId, title] of [
      [first, "A"],
      [second, "B"],
    ] as const) {
      const saved = await client("/patches", "PUT", {
        body: {
          parentRef: { type: "head", headBaseSha: baseSha },
          patches: [{ path: HOME, patchId, patch: titlePatch(title) }],
        },
      });
      expect(saved.status).toBe(200);
    }
    expect((await stat(client)).patches).toEqual([first, second]);
  });

  test("keeps the edits across a reload of the tab, and forgets them on reset", async () => {
    const storage = mapStorage();
    const before = clientFor(storage);
    const { baseSha } = await stat(before);
    const patchId = "00000000-0000-4000-8000-000000000001" as PatchId;
    await before("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: baseSha },
        patches: [{ path: HOME, patchId, patch: titlePatch("Kept") }],
      },
    });

    // A reload: a new server over the same storage.
    expect((await stat(clientFor(storage))).patches).toEqual([patchId]);

    // Reset: what the demo's button does.
    storage.removeItem(DEMO_PATCHES_STORAGE_KEY);
    expect((await stat(clientFor(storage))).patches).toEqual([]);
  });

  test("discards an edit", async () => {
    const storage = mapStorage();
    const client = clientFor(storage);
    const { baseSha } = await stat(client);
    const patchId = "00000000-0000-4000-8000-000000000001" as PatchId;
    await client("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: baseSha },
        patches: [{ path: HOME, patchId, patch: titlePatch("Gone") }],
      },
    });
    const deleted = await client("/patches", "DELETE", {
      query: { id: [patchId] },
      body: undefined,
    });
    expect(deleted.status).toBe(200);
    expect((await stat(client)).patches).toEqual([]);
    expect(storage.values.has(DEMO_PATCHES_STORAGE_KEY)).toBe(false);
  });
});
