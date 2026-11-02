import { initVal, modules } from "@valbuild/core";
import type { PatchId, ValModule, SelectorSource } from "@valbuild/core";
import {
  ModuleVersionSchema,
  ProjectVersionSchema,
  chainOf,
  versionHashCount,
  type ValServerGenericResult,
} from "@valbuild/shared/internal";
import { z } from "zod";
import { createValApiRouter, createValServer } from "./ValRouter";
import { fakeRequest } from "./fakeRequest";
import { InMemoryPatchStore } from "./ValOpsMemory";

/**
 * `GET /manifest` and the versions every content answer carries (phase 1 of
 * `docs/plans/one-content-model.md`): computed when content changes, never
 * when it is read, and the same on every answer.
 */
describe("/manifest", () => {
  const route = "/api/val";
  const { c, s, config } = initVal({});
  const home = c.define(
    "/content/home.val.ts",
    s.object({ title: s.string() }),
    { title: "Hello" },
  );
  const homeWithCta = c.define(
    "/content/home.val.ts",
    s.object({ title: s.string(), cta: s.string() }),
    { title: "Hello", cta: "Buy" },
  );
  const footer = c.define(
    "/content/footer.val.ts",
    s.object({ text: s.string() }),
    { text: "Footer" },
  );

  const Manifest = z.object({
    project: ProjectVersionSchema,
    modules: z.record(z.string(), ModuleVersionSchema),
  });
  const Tree = z.object({
    modules: z.record(
      z.string(),
      z.object({ source: z.unknown(), version: ModuleVersionSchema }),
    ),
    project: ProjectVersionSchema,
  });
  const Stat = z.object({ version: ProjectVersionSchema });

  const start = (
    build: ValModule<SelectorSource>[] = [home, footer],
    patchStore = new InMemoryPatchStore(),
  ) => {
    const handler = createValApiRouter(
      route,
      createValServer(
        modules(
          config,
          build.map((module) => ({
            def: () => Promise.resolve({ default: module }),
          })),
        ),
        route,
        {
          disableCache: true,
          sourceFiles: {
            "/content/home.val.ts": "",
            "/content/footer.val.ts": "",
          },
          patchStore,
          unsafelyAllowUnauthenticated: true,
        },
        config,
        {
          async isEnabled() {
            return true;
          },
          async onDisable() {},
          async onEnable() {},
        },
      ),
      (res: ValServerGenericResult) => res,
    );
    const send = async (
      method: string,
      path: string,
      init: { json?: unknown; headers?: Headers } = {},
    ) =>
      handler(
        fakeRequest({
          method,
          url: new URL(`http://localhost:3000${route}${path}`),
          ...init,
        }),
      );
    const manifest = async (etag?: string) => {
      const res = await send("GET", "/manifest", {
        headers: new Headers(
          etag !== undefined ? { "if-none-match": etag } : {},
        ),
      });
      const headers: Record<string, string | undefined> =
        ("headers" in res && res.headers) || {};
      return {
        status: res.status,
        etag: headers["ETag"],
        json: "json" in res ? Manifest.parse(res.json) : null,
      };
    };
    const edit = async (patchId: PatchId, title: string) => {
      const res = await send("PUT", "/patches", {
        json: {
          parentRef: { type: "head", headBaseSha: "ignored" },
          patches: [
            {
              path: "/content/home.val.ts",
              patchId,
              patch: [{ op: "replace", path: ["title"], value: title }],
            },
          ],
        },
      });
      expect(res.status).toBe(200);
    };
    return { send, manifest, edit };
  };

  const p1 = "00000000-0000-4000-8000-000000000001" as PatchId;
  const p2 = "00000000-0000-4000-8000-000000000002" as PatchId;

  test("names every module's version, and an edit moves only its module's chain and the seq", async () => {
    const { manifest, edit } = start();
    const before = await manifest();
    expect(before.status).toBe(200);
    const home0 = before.json?.modules["/content/home.val.ts"];
    const footer0 = before.json?.modules["/content/footer.val.ts"];
    expect(home0?.chain).toBe("");

    await edit(p1, "Hello world");
    const after = await manifest();
    expect(after.json?.modules["/content/home.val.ts"]).toEqual({
      schema: home0?.schema,
      base: home0?.base,
      chain: chainOf([p1]),
    });
    expect(after.json?.modules["/content/footer.val.ts"]).toEqual(footer0);
    expect(after.json?.project.build).toBe(before.json?.project.build);
    expect(after.json?.project.seq).toBeGreaterThan(
      before.json?.project.seq ?? Infinity,
    );
  });

  test("answers 304 to its own ETag while nothing moved, and 200 once something did", async () => {
    const { manifest, edit } = start();
    const first = await manifest();
    expect(first.etag).toEqual(expect.any(String));
    expect((await manifest(first.etag)).status).toBe(304);

    await edit(p1, "Hello world");
    const moved = await manifest(first.etag);
    expect(moved.status).toBe(200);
    expect(moved.etag).not.toBe(first.etag);
  });

  test("reading hashes nothing: not the manifest, not the tree, not /stat", async () => {
    const { send, manifest, edit } = start();
    await edit(p1, "Hello world");
    await manifest(); // the chain grew: folded here, once
    const before = versionHashCount();
    await manifest();
    await send("PUT", "/sources/~");
    await send("POST", "/stat", { json: null });
    await send("GET", "/patches");
    expect(versionHashCount() - before).toBe(0);
    // And a write costs its own patch, nothing more.
    await edit(p2, "Hello again");
    const write = versionHashCount();
    await manifest();
    expect(versionHashCount() - write).toBe(1);
  });

  test("the tree and /stat carry the same versions as the manifest", async () => {
    const { send, manifest, edit } = start();
    await edit(p1, "Hello world");
    const { json } = await manifest();
    const tree = await send("PUT", "/sources/~");
    expect(tree.status).toBe(200);
    const treeJson = "json" in tree ? Tree.parse(tree.json) : null;
    expect(treeJson?.modules["/content/home.val.ts"]).toEqual({
      source: { title: "Hello world" },
      version: json?.modules["/content/home.val.ts"],
    });
    expect(treeJson?.project).toEqual(json?.project);
    const stat = await send("POST", "/stat", { json: null });
    expect("json" in stat ? Stat.parse(stat.json).version : null).toEqual(
      json?.project,
    );
  });

  test("a new build is counted once, and two builds answering at once do not move seq", async () => {
    const store = new InMemoryPatchStore();
    const old = start([home, footer], store);
    const before = await old.manifest();
    const next = start([homeWithCta, footer], store);
    const after = await next.manifest();
    expect(after.json?.project.build).not.toBe(before.json?.project.build);
    expect(after.json?.project.seq).toBeGreaterThan(
      before.json?.project.seq ?? Infinity,
    );
    // A rollout: both answer, in turn. Reading moves nothing.
    const seqs = [];
    for (let i = 0; i < 3; i++) {
      seqs.push((await old.manifest()).json?.project.seq);
      seqs.push((await next.manifest()).json?.project.seq);
    }
    expect(new Set(seqs)).toEqual(new Set([after.json?.project.seq]));
  });
});
