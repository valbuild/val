import { initVal, modules } from "@valbuild/core";
import fs from "fs";
import path from "node:path";
import { createValApiRouter, createValServer } from "./ValRouter";
import { fakeRequest } from "./fakeRequest";
import {
  isMediaFilePath,
  isPublicFilePath,
  isSafePatchId,
} from "./safeFilePath";

/**
 * What Val's API refuses in fs mode, where no route asks who is calling.
 *
 * Each of these was answered before: a file anywhere in the project read
 * through `/files`, an upload written outside the patch store, a request
 * from another site's page, and all of it on a deployed site that had no
 * credentials set. Driven through the router, as a browser's request is.
 */
describe("fs mode: what the API refuses", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();
  const PATCH_ID = "6f4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c";
  const smallPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

  const makeRoute = (onEnable: () => Promise<void> = async () => {}) =>
    createValApiRouter(
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
        { disableCache: true, project: "org/project" },
        config,
        {
          async isEnabled() {
            return false;
          },
          async onDisable() {},
          onEnable,
        },
      ),
      (res) => res,
    );

  const get = (
    onRoute: ReturnType<typeof makeRoute>,
    pathAndQuery: string,
    headers: Record<string, string> = {},
  ) =>
    onRoute(
      fakeRequest({
        method: "GET",
        url: new URL(`http://localhost:3000${route}${pathAndQuery}`),
        headers: new Headers(headers),
      }),
    );

  const upload = (
    onRoute: ReturnType<typeof makeRoute>,
    filePath: string,
    headers: Record<string, string> = {},
  ) =>
    onRoute(
      fakeRequest({
        method: "POST",
        url: new URL(
          `http://localhost:3000${route}/upload/patches/${PATCH_ID}/files`,
        ),
        headers: new Headers(headers),
        json: {
          parentRef: { type: "head", headBaseSha: "x" },
          filePath,
          data: smallPng,
          type: "image",
          metadata: { width: 1, height: 1, mimeType: "image/png" },
          remote: false,
        },
      }),
    );

  describe("/files", () => {
    test("a file outside /public is not found, though it is on disk", async () => {
      // jest runs at the repository root, which is this server's project root.
      expect(fs.existsSync(path.join(process.cwd(), "package.json"))).toBe(
        true,
      );
      const onRoute = makeRoute();
      for (const file of [
        "/package.json",
        "/.github/workflows/check.yml",
        "/public/../package.json",
        "/packages/server/package.json",
      ]) {
        const res = await get(onRoute, `/files${file}`);
        expect(res.status).toBe(404);
      }
    });

    test("a patch id that is a path is refused", async () => {
      const res = await get(
        makeRoute(),
        `/files/public/val/x.png?patch_id=${encodeURIComponent("../../packages")}`,
      );
      expect(res.status).toBe(400);
    });
  });

  describe("/upload/patches", () => {
    const written = path.join(process.cwd(), "val-upload-escaped.png");
    afterEach(() => fs.rmSync(written, { recursive: true, force: true }));

    test("a file path that leaves the patch store is refused, and nothing is written", async () => {
      const onRoute = makeRoute();
      for (const filePath of [
        "../../../../val-upload-escaped.png",
        "/public/../../../../val-upload-escaped.png",
        "/val-upload-escaped.png",
        "public\\..\\..\\val-upload-escaped.png",
      ]) {
        const res = await upload(onRoute, filePath);
        expect(res.status).toBe(400);
        expect(fs.existsSync(written)).toBe(false);
      }
    });
  });

  describe("requests from somewhere else", () => {
    test("another site's page is refused, by Origin", async () => {
      const res = await upload(makeRoute(), "/public/val/x.png", {
        Host: "localhost:3000",
        Origin: "https://evil.example",
        "Content-Type": "text/plain",
      });
      expect(res.status).toBe(403);
    });

    test("an opaque origin is refused", async () => {
      const res = await get(makeRoute(), "/patches", { Origin: "null" });
      expect(res.status).toBe(403);
    });

    test("a cross-site request without an Origin is refused, a followed link is not", async () => {
      const onRoute = makeRoute();
      expect(
        (
          await get(onRoute, "/patches", {
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "no-cors",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await get(onRoute, "/patches", {
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "navigate",
          })
        ).status,
      ).toBe(200);
    });

    test("the Studio's own requests are answered", async () => {
      const onRoute = makeRoute();
      const own: Record<string, string>[] = [
        {},
        { Host: "localhost:3000", Origin: "http://localhost:3000" },
        { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
        { Host: "192.168.1.20:3000", Origin: "http://192.168.1.20:3000" },
        { Host: "[::1]:3000", Origin: "http://[::1]:3000" },
        { Host: "app.localhost:3000" },
        // Behind a proxy: the public name is in X-Forwarded-Host.
        {
          Host: "localhost:3000",
          "X-Forwarded-Host": "dev.example.app",
          Origin: "https://dev.example.app",
        },
      ];
      for (const headers of own) {
        expect((await get(onRoute, "/patches", headers)).status).toBe(200);
      }
    });

    test("a name that is not localhost is refused, unless it is listed", async () => {
      const headers = {
        Host: "rebind.evil.example:3000",
        Origin: "http://rebind.evil.example:3000",
      };
      const res = await get(makeRoute(), "/patches", headers);
      expect(res.status).toBe(403);
      expect("json" in res && res.json).toEqual({
        message: expect.stringContaining("VAL_ALLOWED_HOSTS"),
      });

      process.env.VAL_ALLOWED_HOSTS = "my-app.test, rebind.evil.example";
      try {
        expect((await get(makeRoute(), "/patches", headers)).status).toBe(200);
      } finally {
        delete process.env.VAL_ALLOWED_HOSTS;
      }
    });
  });

  describe("a deployed site without credentials", () => {
    const nodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = nodeEnv;
    });

    test("answers nothing but beacons, and says what to set", async () => {
      process.env.NODE_ENV = "production";
      const onRoute = makeRoute();
      const res = await get(onRoute, "/patches");
      expect(res.status).toBe(403);
      expect("json" in res && res.json).toEqual({
        message: expect.stringContaining("VAL_API_KEY and VAL_SECRET"),
      });
      expect((await get(onRoute, "/files/public/val/x.png")).status).toBe(403);
      expect((await upload(onRoute, "/public/val/x.png")).status).toBe(403);
    });
  });

  test("/authorize does not turn draft mode on: nobody has signed in yet", async () => {
    const onEnable = jest.fn(async () => {});
    const res = await get(
      makeRoute(onEnable),
      `/authorize?redirect_to=${encodeURIComponent("http://localhost:3000/val")}`,
    );
    expect(res.status).toBe(302);
    expect(onEnable).not.toHaveBeenCalled();
  });
});

describe("safeFilePath", () => {
  test("a local media path is under /public and stays there", () => {
    expect(isPublicFilePath("/public/val/photo_a1b2c.jpg")).toBe(true);
    expect(isPublicFilePath("/public/val/clip_abc12/480p.m3u8")).toBe(true);
    for (const filePath of [
      "/public",
      "/.env",
      "/src/routes/index.tsx",
      "/public/../.env",
      "/public/val/./x.png",
      "/public/val\\..\\..\\x.png",
      "/public/val/x.png\0.txt",
      "public/val/x.png",
    ]) {
      expect(isPublicFilePath(filePath)).toBe(false);
    }
  });

  test("a file op names a local media path or a remote ref", () => {
    expect(isMediaFilePath("/public/val/photo_a1b2c.jpg")).toBe(true);
    expect(
      isMediaFilePath(
        "https://remote.val.build/file/p/abc/b/01/v/0.1.0/h/1a2b/f/3c4d/p/public/val/photo.jpg",
      ),
    ).toBe(true);
    for (const filePath of [
      "",
      "/etc/passwd",
      "../../x",
      "https://remote.val.build/file/../../../x",
    ]) {
      expect(isMediaFilePath(filePath)).toBe(false);
    }
  });

  test("a patch id is one path segment", () => {
    expect(isSafePatchId("6f4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c")).toBe(true);
    for (const patchId of ["", ".", "..", "../x", "a/b", "a\\b", "a\0"]) {
      expect(isSafePatchId(patchId)).toBe(false);
    }
  });
});
