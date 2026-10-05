import { initVal, modules, type PatchId } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { fakeRequest } from "./fakeRequest";
import { InMemoryPatchStore } from "./ValOpsMemory";

/**
 * `/files` serving video: byte ranges, the content type a player decides by,
 * and draft HLS playlists whose URIs are rewritten to stay drafts.
 *
 * Driven through the router rather than by calling the route, because the
 * `Range` header reaching the route at all is part of what is under test: the
 * router passes a route only the headers its `Api` entry declares.
 */
describe("/files", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();
  const PATCH_ID = "6f4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c" as PatchId;
  const VIDEO = Buffer.from(Array.from({ length: 100 }, (_, i) => i % 256));
  const MASTER = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.64001e"',
    "480p.m3u8",
    "",
  ].join("\n");

  const makeRoute = async () => {
    const patchStore = new InMemoryPatchStore();
    await patchStore.putFile({
      patchId: PATCH_ID,
      filePath: "/public/val/intro_abc12.mp4",
      data: VIDEO,
      metadata: { mimeType: "video/mp4" },
    });
    await patchStore.putFile({
      patchId: PATCH_ID,
      filePath: "/public/val/clip_abc12/master.m3u8",
      data: Buffer.from(MASTER),
      metadata: { mimeType: "application/vnd.apple.mpegurl" },
    });
    return createValApiRouter(
      route,
      createValServer(
        modules(config, [
          {
            def: () =>
              Promise.resolve({
                default: c.define("/content/page.val.ts", s.string(), "hello"),
              }),
          },
        ]),
        route,
        {
          disableCache: true,
          sourceFiles: { "/content/page.val.ts": "" },
          patchStore,
          versions: { core: "0.0.0-test", next: "0.0.0-test" },
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
      (res) => res,
    );
  };

  const get = async (path: string, headers: Record<string, string> = {}) => {
    const handler = await makeRoute();
    const res = await handler(
      fakeRequest({
        method: "GET",
        url: new URL(`http://localhost:3000${route}/files${path}`),
        headers: new Headers(headers),
      }),
    );
    const body =
      "body" in res && res.body instanceof ReadableStream
        ? Buffer.from(await new Response(res.body).arrayBuffer())
        : undefined;
    const responseHeaders = "headers" in res ? (res.headers ?? {}) : {};
    return { status: res.status, headers: responseHeaders, body };
  };

  const DRAFT_VIDEO = `/public/val/intro_abc12.mp4?patch_id=${PATCH_ID}`;

  test("the whole file says it takes ranges, and what it is", async () => {
    const res = await get(DRAFT_VIDEO);
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Length": "100",
    });
    expect(res.body?.equals(VIDEO)).toBe(true);
  });

  test("a range is a 206 with exactly those bytes", async () => {
    const res = await get(DRAFT_VIDEO, { Range: "bytes=10-19" });
    expect(res.status).toBe(206);
    expect(res.headers).toMatchObject({
      "Content-Type": "video/mp4",
      "Content-Range": "bytes 10-19/100",
      "Content-Length": "10",
    });
    expect(res.body?.equals(VIDEO.subarray(10, 20))).toBe(true);
  });

  test("an open-ended and a suffix range", async () => {
    const open = await get(DRAFT_VIDEO, { Range: "bytes=95-" });
    expect(open.status).toBe(206);
    expect(open.headers).toMatchObject({ "Content-Range": "bytes 95-99/100" });
    const suffix = await get(DRAFT_VIDEO, { Range: "bytes=-3" });
    expect(suffix.status).toBe(206);
    expect(suffix.body?.equals(VIDEO.subarray(97))).toBe(true);
  });

  test("a range past the end is a 416 that says how big the file is", async () => {
    const res = await get(DRAFT_VIDEO, { Range: "bytes=100-" });
    expect(res.status).toBe(416);
    expect(res.headers).toMatchObject({ "Content-Range": "bytes */100" });
  });

  test("a draft master playlist names its renditions as drafts", async () => {
    const res = await get(
      `/public/val/clip_abc12/master.m3u8?patch_id=${PATCH_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({
      "Content-Type": "application/vnd.apple.mpegurl",
    });
    expect(res.body?.toString("utf-8")).toBe(
      [
        "#EXTM3U",
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.64001e"',
        `/api/val/files/public/val/clip_abc12/480p.m3u8?patch_id=${PATCH_ID}`,
        "",
      ].join("\n"),
    );
  });

  test("a file that is not there is still a 404", async () => {
    const res = await get(`/public/val/nope.mp4?patch_id=${PATCH_ID}`, {
      Range: "bytes=0-1",
    });
    expect(res.status).toBe(404);
  });
});
