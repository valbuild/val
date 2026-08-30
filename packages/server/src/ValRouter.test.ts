import fs from "fs";
import os from "os";
import path from "path";
import { initVal, modules } from "@valbuild/core";
import type { SelectorSource, ValModule } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";

describe("ValRouter", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();
  const authorItemSchema = s.object({
    name: s.string(),
    birthdate: s.date().from("1900-01-01").to("2024-01-01"),
  });
  const authorsSchema = s.record(authorItemSchema);
  const authorsSource = {
    teddy: {
      name: "Theodor René Carlsen",
      birthdate: "1970-01-01",
    },
    freekh: { name: "Fredrik Ekholdt", birthdate: "1970-01-01" },
    erlamd: { name: "Erlend Åmdal", birthdate: "1970-01-01" },
    thoram: { name: "Thomas Ramirez", birthdate: "1970-01-01" },
    isabjo: { name: "Isak Bjørnstad", birthdate: "1970-01-01" },
    kimmid: { name: "Kim Midtlid", birthdate: "1970-01-01" },
  };
  const createOnRoute = (valModule: ValModule<SelectorSource>) =>
    createValApiRouter(
      route,
      createValServer(
        modules(config, [
          {
            def: () =>
              Promise.resolve({
                default: valModule,
              }),
          },
        ]),
        route,
        {
          disableCache: true,
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
  const onRoute = createOnRoute(
    c.define("/content/authors.val.ts", authorsSchema, authorsSource),
  );

  test("smoke test valid route: /sources/~", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "PUT",
        url: new URL("http://localhost:3000/api/val/sources/~"),
        json: {},
        headers: new Headers({
          Cookie: `val_session=${encodeJwt({}, "")}`,
        }),
      }),
    );
    expect(serverRes).toBeDefined();
    expect(serverRes.status).toBe(200);
    expect("json" in serverRes && serverRes.json).toBeTruthy();
  });

  // NOTE: the studio applies patches on the client and therefore requests
  // sources with apply_patches=false. Previews must be returned either way:
  // the preview functions only exist on the server (they are not part of the
  // serialized schema), so the client cannot compute them itself.
  const patchedAuthorName = "Fredrik Ekholdt (patched)";
  const patchedAuthorsSource = {
    ...authorsSource,
    freekh: {
      ...authorsSource.freekh,
      name: patchedAuthorName,
    },
  };

  test.each([
    {
      query: undefined,
      expectedSource: patchedAuthorsSource,
      expectedBaseSource: authorsSource,
    },
    {
      query: "apply_patches=false",
      expectedSource: authorsSource,
      expectedBaseSource: undefined,
    },
    {
      query: "apply_patches=true",
      expectedSource: patchedAuthorsSource,
      expectedBaseSource: authorsSource,
    },
  ])(
    "/sources/~ returns previews (query: $query)",
    async ({ query, expectedSource, expectedBaseSource }) => {
      // This case creates a real pending patch, and an fs-mode server stores
      // patches under `${process.cwd()}/.val`. Rooted at the repo that writes
      // .val/patches/head/patch.json into the checkout - which every fs-mode
      // server then loads as the current pending head, so local Studio and
      // other server tests would start with a synthetic edit to
      // /content/authors.val.ts. cwd() is not overridable through
      // ValApiOptions, so point it at a scratch directory for the duration.
      const valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-router-"));
      const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(valRoot);
      try {
        await runPreviewCase({ query, expectedSource, expectedBaseSource });
      } finally {
        cwdSpy.mockRestore();
        fs.rmSync(valRoot, { recursive: true, force: true });
      }
    },
  );

  async function runPreviewCase({
    query,
    expectedSource,
    expectedBaseSource,
  }: {
    query: string | undefined;
    expectedSource: typeof authorsSource;
    expectedBaseSource: typeof authorsSource | undefined;
  }) {
    {
      const onRouteWithPreview = createOnRoute(
        c.define(
          "/content/authors.val.ts",
          s.record(
            authorItemSchema.preview(({ val }) => ({
              title: val.name,
              subtitle: val.birthdate,
            })),
          ),
          authorsSource,
        ),
      );
      const patchesRes = await onRouteWithPreview(
        fakeRequest({
          method: "GET",
          url: new URL("http://localhost:3000/api/val/patches"),
          headers: new Headers({
            Cookie: `val_session=${encodeJwt({}, "")}`,
          }),
        }),
      );
      expect(patchesRes.status).toBe(200);
      if (patchesRes.status !== 200 || !("json" in patchesRes)) {
        throw new Error("Expected a 200 response with a json body");
      }
      // Narrow the Json body down to the one field this test needs, rather
      // than asserting: `json` is `Json | null`, so indexing it is not valid
      // until it is known to carry a string baseSha. `in` rather than
      // Array.isArray, because JsonArray is a *readonly* array and
      // Array.isArray does not narrow those away.
      const patchesBody = patchesRes.json;
      if (
        patchesBody === null ||
        typeof patchesBody !== "object" ||
        !("baseSha" in patchesBody) ||
        typeof patchesBody.baseSha !== "string"
      ) {
        throw new Error("Expected the patches response to carry a baseSha");
      }
      const createPatchRes = await onRouteWithPreview(
        fakeRequest({
          method: "PUT",
          url: new URL("http://localhost:3000/api/val/patches"),
          json: {
            patches: [
              {
                path: "/content/authors.val.ts",
                patchId: "11111111-1111-4111-8111-111111111111",
                patch: [
                  {
                    op: "replace",
                    path: ["freekh", "name"],
                    value: patchedAuthorName,
                  },
                ],
              },
            ],
            parentRef: {
              type: "head",
              headBaseSha: patchesBody.baseSha,
            },
          },
          headers: new Headers({
            Cookie: `val_session=${encodeJwt({}, "")}`,
          }),
        }),
      );
      expect(createPatchRes.status).toBe(200);
      const serverRes = await onRouteWithPreview(
        fakeRequest({
          method: "PUT",
          url: new URL(
            `http://localhost:3000/api/val/sources/~${query ? `?${query}` : ""}`,
          ),
          json: {},
          headers: new Headers({
            Cookie: `val_session=${encodeJwt({}, "")}`,
          }),
        }),
      );
      expect(serverRes.status).toBe(200);
      if (serverRes.status !== 200 || !("json" in serverRes)) {
        throw new Error("Expected a 200 response with a json body");
      }
      const json = serverRes.json as unknown as {
        modules: Record<
          string,
          { source?: unknown; baseSource?: unknown; preview?: unknown }
        >;
      };
      expect(json.modules["/content/authors.val.ts"]?.source).toEqual(
        expectedSource,
      );
      expect(json.modules["/content/authors.val.ts"]?.baseSource).toEqual(
        expectedBaseSource,
      );
      expect(json.modules["/content/authors.val.ts"]?.preview).toEqual({
        "/content/authors.val.ts": {
          status: "success",
          data: {
            parent: "record",
            items: Object.entries(patchedAuthorsSource).map(([key, author]) => [
              key,
              {
                title: author.name,
                subtitle: author.birthdate,
                image: undefined,
              },
            ]),
          },
        },
      });
    }
  }

  test("smoke test valid route: /schema", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "GET",
        url: new URL("http://localhost:3000/api/val/schema"),
        json: {},
        headers: new Headers({
          Cookie: `val_session=${encodeJwt({}, "")}`,
        }),
      }),
    );
    expect(serverRes).toBeDefined();
    expect(serverRes.status).toBe(200);
    expect("json" in serverRes && serverRes.json).toBeTruthy();
  });

  test("smoke test valid route: /patches", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "GET",
        url: new URL("http://localhost:3000/api/val/patches"),
      }),
    );
    expect(serverRes).toBeDefined();
    expect(serverRes.status).toBe(200);
    expect("json" in serverRes && serverRes.json).toBeTruthy();
  });

  // `/json` takes exactly one of `key`, `keys` or `offset`+`limit`. These are
  // rejected before the ops layer is consulted, so the fixture module (an
  // ordinary record) is enough to pin the contract.
  describe("/json request shapes", () => {
    const jsonRequest = (query: string) =>
      onRoute(
        fakeRequest({
          method: "GET",
          url: new URL(`http://localhost:3000/api/val/json?${query}`),
          headers: new Headers({
            Cookie: `val_session=${encodeJwt({}, "")}`,
          }),
        }),
      );

    test("no shape is a 400", async () => {
      expect((await jsonRequest("path=/content/authors.val.ts")).status).toBe(
        400,
      );
    });

    test("key AND keys together is a 400", async () => {
      expect(
        (await jsonRequest("path=/content/authors.val.ts&key=a&keys=b")).status,
      ).toBe(400);
    });

    test("offset without limit is a 400", async () => {
      expect(
        (await jsonRequest("path=/content/authors.val.ts&offset=0")).status,
      ).toBe(400);
    });

    test("more keys than the batch cap is rejected", async () => {
      const keys = Array.from({ length: 101 }, (_, i) => `keys=k${i}`).join(
        "&",
      );
      expect(
        (await jsonRequest(`path=/content/authors.val.ts&${keys}`)).status,
      ).toBe(400);
    });

    test("a valid shape gets past validation (404: no such module)", async () => {
      expect(
        (await jsonRequest("path=/content/nope.val.ts&key=a")).status,
      ).toBe(404);
    });
  });

  test("smoke test invalid route", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "PUT",
        url: new URL(
          "http://localhost:3000/api/val/invalid/~?validate_all=true&validate_sources=true",
        ),
        json: {},
        headers: new Headers({
          Cookie: `val_session=${encodeJwt({}, "")}`,
        }),
      }),
    );
    expect(serverRes).toBeDefined();
    expect(serverRes.status).toBe(404);
    expect("json" in serverRes && serverRes.json).toBeTruthy();
  });
});

function fakeRequest({
  url,
  method,
  headers,
  json,
}: {
  method: string;
  url: URL;
  headers?: Headers;
  json?: unknown;
}): Request {
  return {
    method,
    url,
    headers,
    json: async () => json,
  } as unknown as Request;
}
