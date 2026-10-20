import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import { createValClient } from "@valbuild/shared/internal";
import { createInTabValFetch, type InTabFetch } from "./inTabFetch";

/**
 * The demo's whole server path, with only the network removed: the Studio's
 * own client, the router and `ValServer` in memory mode.
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
            s.object({ title: s.string(), image: s.image().nullable() }),
            { title: "Hello", image: null },
          ),
        }),
    },
  ],
};

const HOME = "/content/home.val.ts" as ModuleFilePath;

function inTab(): InTabFetch {
  return createInTabValFetch(valModules, { config });
}

function clientOf(fetch: InTabFetch) {
  return createValClient("/api/val", null, { fetch });
}

async function stat(client: ReturnType<typeof clientOf>) {
  const res = await client("/stat", "POST", { body: null });
  if (res.status !== 200 || !("baseSha" in res.json)) {
    throw new Error(
      `/stat answered ${res.status}: ${JSON.stringify(res.json)}`,
    );
  }
  return res.json;
}

const titlePatch = (title: string) => [
  { op: "replace" as const, path: ["title"], value: title },
];

const PATCH_ID = "00000000-0000-4000-8000-000000000001" as PatchId;

/**
 * Upload bytes as the Studio does: a POST to the upload URL the server hands
 * out, which in the demo is relayed to the in-tab server by a service worker
 * rather than sent over the network.
 */
async function upload(
  fetch: InTabFetch,
  filePath: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  const data = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  return fetch(`/api/val/upload/patches/${PATCH_ID}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath,
      parentRef: { type: "head", headBaseSha: "" },
      data,
      type: "file",
      metadata: { mimeType },
      remote: false,
    }),
  });
}

describe("the in-tab server", () => {
  test("answers /stat as a local, authenticated-without-asking server", async () => {
    const answer = await stat(clientOf(inTab()));
    expect("mode" in answer && answer.mode).toBe("fs");
    expect(answer.patches).toEqual([]);
  });

  // The full check reads files and asks remote hosts, which a tab has no way
  // to: it says so, as a 501 the Studio shows without a Try again.
  test("answers the full check as not available here", async () => {
    const res = await clientOf(inTab())("/validate", "POST", {
      body: { moduleFilePath: HOME },
    });
    expect(res.status).toBe(501);
  });

  test("answers /profiles with nobody, not an error, without a project", async () => {
    const res = await clientOf(inTab())("/profiles", "GET", {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ profiles: [] });
  });

  test("takes a Request, and init overrides it, as fetch does", async () => {
    const fetch = inTab();
    const asRequest = await fetch(
      new Request("http://localhost/api/val/profiles"),
    );
    expect(asRequest.status).toBe(200);
    // The method comes from `init`, not from the Request it was given.
    const overridden = await fetch(
      new Request("http://localhost/api/val/profiles"),
      { method: "DELETE" },
    );
    expect(overridden.status).not.toBe(200);
  });

  test("saves an edit on the head and serves it back", async () => {
    const client = clientOf(inTab());
    const { baseSha } = await stat(client);
    const saved = await client("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: baseSha },
        patches: [{ path: HOME, patchId: PATCH_ID, patch: titlePatch("Hi") }],
      },
    });
    expect(saved.status).toBe(200);

    expect((await stat(client)).patches).toEqual([PATCH_ID]);
    const fetched = await client("/patches", "GET", {
      query: { patch_id: [PATCH_ID], exclude_patch_ops: false },
    });
    expect(fetched.status).toBe(200);
    expect(JSON.stringify(fetched.json)).toContain('"Hi"');
  });

  test("puts every save last, whatever parent it names, as fs mode does", async () => {
    // Memory mode, like fs mode, decides the order itself: the store's order
    // IS the chain (see `ValOpsMemory.saveSourceFilePatch`). So a save naming
    // a parent that is no longer the head is appended, not refused.
    const client = clientOf(inTab());
    const { baseSha } = await stat(client);
    const second = "00000000-0000-4000-8000-000000000002" as PatchId;
    for (const [patchId, title] of [
      [PATCH_ID, "A"],
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
    expect((await stat(client)).patches).toEqual([PATCH_ID, second]);
  });

  test("holds edits in memory only: a new server -- a reload -- starts over", async () => {
    const client = clientOf(inTab());
    const { baseSha } = await stat(client);
    await client("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: baseSha },
        patches: [{ path: HOME, patchId: PATCH_ID, patch: titlePatch("Gone") }],
      },
    });
    expect((await stat(client)).patches).toEqual([PATCH_ID]);
    expect((await stat(clientOf(inTab()))).patches).toEqual([]);
  });

  test("discards an edit", async () => {
    const client = clientOf(inTab());
    const { baseSha } = await stat(client);
    await client("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: baseSha },
        patches: [{ path: HOME, patchId: PATCH_ID, patch: titlePatch("Gone") }],
      },
    });
    const deleted = await client("/patches", "DELETE", {
      query: { id: [PATCH_ID] },
      body: undefined,
    });
    expect(deleted.status).toBe(200);
    expect((await stat(client)).patches).toEqual([]);
  });
});

describe("files, through the in-tab server", () => {
  const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

  test("an uploaded file is served back by /files with its patch id", async () => {
    const fetch = inTab();
    const uploaded = await upload(
      fetch,
      "/public/val/a.png",
      "image/png",
      BYTES,
    );
    expect(uploaded.status).toBe(200);

    const res = await fetch(
      `/api/val/files/public/val/a.png?patch_id=${PATCH_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  test("answers a Range request, which seeking a video depends on", async () => {
    const fetch = inTab();
    await upload(fetch, "/public/val/clip.mp4", "video/mp4", BYTES);
    const res = await fetch(
      `/api/val/files/public/val/clip.mp4?patch_id=${PATCH_ID}`,
      { headers: { Range: "bytes=2-5" } },
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 2-5/${BYTES.length}`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(2, 6));
  });

  test("rewrites a draft HLS playlist to point back at the draft files", async () => {
    const fetch = inTab();
    const playlist =
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nplaylist-0.m3u8\n";
    await upload(
      fetch,
      "/public/val/videos/clip_abcde/master.m3u8",
      "application/vnd.apple.mpegurl",
      new TextEncoder().encode(playlist),
    );
    const res = await fetch(
      `/api/val/files/public/val/videos/clip_abcde/master.m3u8?patch_id=${PATCH_ID}`,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("playlist-0.m3u8");
    expect(text).toContain(`patch_id=${PATCH_ID}`);
  });

  test("an unknown file is a 404, not a throw", async () => {
    const res = await inTab()(
      `/api/val/files/public/val/missing.png?patch_id=${PATCH_ID}`,
    );
    expect(res.status).toBe(404);
  });
});
