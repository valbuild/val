import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { fakeRequest } from "./fakeRequest";
import { InMemoryPatchStore } from "./ValOpsMemory";

/**
 * The files that make the Studio installable, served by the API route every
 * project already has: driven through the router, because being reached at
 * all -- ahead of `Api`, which knows none of these paths -- is what is tested.
 */
describe("the Studio app's files", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();

  const get = async (path: string) => {
    const handler = createValApiRouter(
      route,
      createValServer(
        modules(config, [
          {
            def: () =>
              Promise.resolve({
                default: c.define("/content/page.val.ts", s.string(), "hi"),
              }),
          },
        ]),
        route,
        {
          disableCache: true,
          sourceFiles: { "/content/page.val.ts": "" },
          patchStore: new InMemoryPatchStore(),
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
    return handler(
      fakeRequest({
        method: "GET",
        url: new URL(`https://www.example.com${route}${path}`),
        headers: new Headers(),
      }),
    );
  };

  test("the manifest names the site it is the Studio of", async () => {
    const res = await get("/manifest.webmanifest");
    expect(res.status).toBe(200);
    if (!("body" in res) || typeof res.body !== "string") {
      throw new Error("expected a string body");
    }
    expect(JSON.parse(res.body)).toMatchObject({
      name: "Val · www.example.com",
      scope: "/val",
      start_url: "/val/~",
      display: "standalone",
    });
  });

  test("the worker may control the Studio's route from under the API's", async () => {
    const res = await get("/studio-sw.js");
    expect(res.status).toBe(200);
    // With the slash: `/val` would take `/val-preview` from the preview's worker.
    expect("headers" in res && res.headers?.["Service-Worker-Allowed"]).toBe(
      "/val/",
    );
  });

  test("the icons are PNGs", async () => {
    for (const size of [180, 192, 512]) {
      const res = await get(`/icons/val-${size}.png`);
      expect(res.status).toBe(200);
      if (!("body" in res) || !(res.body instanceof ReadableStream)) {
        throw new Error("expected a stream");
      }
      const reader = res.body.getReader();
      const { value } = await reader.read();
      // The PNG signature.
      expect(Array.from(value?.slice(0, 4) ?? [])).toEqual([
        0x89, 0x50, 0x4e, 0x47,
      ]);
    }
  });
});
