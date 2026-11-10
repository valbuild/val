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
    tag: z.string().optional(),
    since: z.number().optional(),
    registry: z.object({ entry: z.string(), core: z.string() }).optional(),
  });
  const Module = z.object({
    kind: z.literal("module"),
    source: z.unknown(),
    version: ModuleVersionSchema,
  });
  const Stat = z.object({
    version: ProjectVersionSchema,
    sourcesSha: z.string(),
  });

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
    const manifest = async (etag?: string, since?: number) => {
      const query = since !== undefined ? `?since=${since}` : "";
      const res = await send("GET", `/manifest${query}`, {
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

  test("names no build's registry outside a build the platform made: HMR brings the code", async () => {
    const { manifest } = start();
    expect((await manifest()).json?.registry).toBeUndefined();
  });

  test("answers 304 to its own ETag while nothing moved, and 200 once something did", async () => {
    const { manifest, edit } = start();
    const first = await manifest();
    expect(first.etag).toEqual(expect.any(String));
    // In the body too, for a client that reads only the body (`ValClient`).
    expect(first.json?.tag).toBe(first.etag);
    expect((await manifest(first.etag)).status).toBe(304);

    await edit(p1, "Hello world");
    const moved = await manifest(first.etag);
    expect(moved.status).toBe(200);
    expect(moved.etag).not.toBe(first.etag);
  });

  test("reading hashes nothing: not the manifest, not a module, not /stat", async () => {
    const { send, manifest, edit } = start();
    await edit(p1, "Hello world");
    await manifest(); // the chain grew: folded here, once
    const before = versionHashCount();
    await manifest();
    await send("GET", "/modules/~/content/home.val.ts");
    await send("POST", "/stat", { json: null });
    await send("GET", "/patches");
    expect(versionHashCount() - before).toBe(0);
    // And a write costs its own patch, nothing more.
    await edit(p2, "Hello again");
    const write = versionHashCount();
    await manifest();
    expect(versionHashCount() - write).toBe(1);
  });

  test("a module read and /stat carry the same versions as the manifest", async () => {
    const { send, manifest, edit } = start();
    await edit(p1, "Hello world");
    const { json } = await manifest();
    const module = await send("GET", "/modules/~/content/home.val.ts");
    expect(module.status).toBe(200);
    const moduleJson = "json" in module ? Module.parse(module.json) : null;
    expect(moduleJson?.source).toEqual({ title: "Hello world" });
    expect(moduleJson?.version).toEqual(json?.modules["/content/home.val.ts"]);
    const stat = await send("POST", "/stat", { json: null });
    expect("json" in stat ? Stat.parse(stat.json).version : null).toEqual(
      json?.project,
    );
  });

  test("/stat carries the manifest when asked: whole, then what GET /manifest?since would say, then unchanged while seq stands", async () => {
    const { send, manifest, edit } = start();
    const StatWithManifest = Stat.extend({
      baseSha: z.string(),
      manifest: z.unknown().optional(),
    });
    const stat = async (body: unknown) => {
      const res = await send("POST", "/stat", { json: body });
      expect(res.status).toBe(200);
      return StatWithManifest.parse("json" in res ? res.json : null);
    };
    const first = await stat(null);
    // Not asked: not read.
    expect(first.manifest).toBeUndefined();
    // A base the server does not have answers at once, rather than parking.
    const asked = { baseSha: "elsewhere", version: first.version, patches: [] };

    const whole = await stat({ ...asked, manifest: null });
    const held = Manifest.extend({ sinceTag: z.string().optional() }).parse(
      whole.manifest,
    );
    expect(Object.keys(held.modules).sort()).toEqual([
      "/content/footer.val.ts",
      "/content/home.val.ts",
    ]);
    expect(held.since).toBeUndefined();
    expect(held.sinceTag).toBeUndefined();
    expect(held.project).toEqual(whole.version);

    await edit(p1, "Hello world");
    const echo = { tag: held.tag ?? "", seq: held.project.seq };
    const moved = await stat({ ...asked, manifest: echo });
    const delta = Manifest.extend({ sinceTag: z.string() }).parse(
      moved.manifest,
    );
    expect(delta.sinceTag).toBe(held.tag);
    expect(delta.since).toBe(held.project.seq);
    expect(Object.keys(delta.modules)).toEqual(["/content/home.val.ts"]);
    // The same answer the manifest route gives the same client: one function.
    const viaGet = await manifest(echo.tag, echo.seq);
    expect(viaGet.json).toEqual({
      project: delta.project,
      modules: delta.modules,
      tag: delta.tag,
      since: delta.since,
    });

    // `seq` did not move since the manifest named: not read, handed back.
    const again = { tag: delta.tag ?? "", seq: delta.project.seq };
    const stood = await stat({ ...asked, patches: [p1], manifest: again });
    expect(stood.manifest).toEqual({ unchanged: true, ...again });
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

  test("since seq N: only the modules that moved since the manifest the client holds", async () => {
    const { manifest, edit } = start();
    const held = await manifest();
    await edit(p1, "Hello world");
    const delta = await manifest(held.etag, held.json?.project.seq);
    expect(delta.status).toBe(200);
    expect(delta.json?.since).toBe(held.json?.project.seq);
    expect(Object.keys(delta.json?.modules ?? {})).toEqual([
      "/content/home.val.ts",
    ]);
    expect(delta.json?.modules["/content/home.val.ts"]?.chain).toBe(
      chainOf([p1]),
    );
    // Nothing moved since the delta: 304, as without `since`.
    expect((await manifest(delta.etag, delta.json?.project.seq)).status).toBe(
      304,
    );
    // And a delta costs no hashing beyond the write's own.
    await edit(p2, "Hello again");
    const before = versionHashCount();
    await manifest(delta.etag, delta.json?.project.seq);
    expect(versionHashCount() - before).toBe(1);
  });

  test("since seq N from a manifest this server did not answer: the whole manifest", async () => {
    const { manifest, edit } = start();
    const held = await manifest();
    await edit(p1, "Hello world");
    for (const [etag, since] of [
      ['"from-another-process"', held.json?.project.seq],
      // The seq does not match the manifest the ETag names.
      [held.etag, (held.json?.project.seq ?? 0) + 7],
    ] as const) {
      const whole = await manifest(etag, since);
      expect(whole.status).toBe(200);
      expect(whole.json?.since).toBeUndefined();
      expect(Object.keys(whole.json?.modules ?? {}).sort()).toEqual([
        "/content/footer.val.ts",
        "/content/home.val.ts",
      ]);
    }
  });

  test("since seq N across a new build: the whole manifest", async () => {
    const store = new InMemoryPatchStore();
    const old = start([home, footer], store);
    const held = await old.manifest();
    const next = start([homeWithCta, footer], store);
    // The ETag is the old build's, which the new instance never answered.
    const answer = await next.manifest(held.etag, held.json?.project.seq);
    expect(answer.json?.since).toBeUndefined();
    expect(Object.keys(answer.json?.modules ?? {}).sort()).toEqual([
      "/content/footer.val.ts",
      "/content/home.val.ts",
    ]);
  });

  /**
   * S26 (`scenarios/src/overlayAfterBuild.scenario.test.ts`): in memory and
   * fs mode the chain is the store's, relative to what the newest build
   * evaluated, so a previous build still answering `/stat` names the newest
   * build's base as the one its chain belongs on. (That it still answered
   * its OWN base when asked for it whole was a property of the whole-tree
   * `PUT /sources/~`, removed in the release after the one content model.)
   */
  test("a previous build still answering names the newest build's base for the chain", async () => {
    const store = new InMemoryPatchStore();
    const old = start([home, footer], store);
    const stat = async (server: ReturnType<typeof start>) => {
      const res = await server.send("POST", "/stat", { json: null });
      return "json" in res ? Stat.parse(res.json) : null;
    };
    const oldOwn = (await stat(old))?.sourcesSha;
    const next = start([homeWithCta, footer], store);
    const nextOwn = (await stat(next))?.sourcesSha;
    expect(nextOwn).not.toBe(oldOwn);
    expect((await stat(old))?.sourcesSha).toBe(nextOwn);
  });

  /**
   * And names the newest build as its version's `build`, as the manifest does
   * -- the value the fs and memory long poll compare a Studio's echo with, so
   * it must be the same whichever instance answers (`ValOps.chainBuild`; see
   * `ValOpsMemory.stat.test.ts`).
   */
  test("a previous build still answering names the newest build as its version's build", async () => {
    const store = new InMemoryPatchStore();
    const old = start([home, footer], store);
    const stat = async (server: ReturnType<typeof start>) => {
      const res = await server.send("POST", "/stat", { json: null });
      return "json" in res ? Stat.parse(res.json) : null;
    };
    const oldBuild = (await stat(old))?.version.build;
    const next = start([homeWithCta, footer], store);
    const nextBuild = (await stat(next))?.version.build;
    expect(nextBuild).not.toBe(oldBuild);
    expect((await stat(old))?.version.build).toBe(nextBuild);
    expect((await old.manifest()).json?.project.build).toBe(nextBuild);
  });
});
