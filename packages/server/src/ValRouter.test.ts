import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";

describe("ValRouter", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();
  const onRoute = createValApiRouter(
    route,
    createValServer(
      modules(config, [
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                "/content/authors.val.ts",
                s.record(
                  s.object({
                    name: s.string(),
                    birthdate: s.date().from("1900-01-01").to("2024-01-01"),
                  }),
                ),
                {
                  teddy: {
                    name: "Theodor René Carlsen",
                    birthdate: "1970-01-01",
                  },
                  freekh: { name: "Fredrik Ekholdt", birthdate: "1970-01-01" },
                  erlamd: { name: "Erlend Åmdal", birthdate: "1970-01-01" },
                  thoram: { name: "Thomas Ramirez", birthdate: "1970-01-01" },
                  isabjo: { name: "Isak Bjørnstad", birthdate: "1970-01-01" },
                  kimmid: { name: "Kim Midtlid", birthdate: "1970-01-01" },
                },
              ),
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

  test("smoke test valid route: /sources", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "PUT",
        url: new URL("http://localhost:3000/api/val/sources"),
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

  test("smoke test valid route: /patches/~", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "GET",
        url: new URL("http://localhost:3000/api/val/patches/~"),
      }),
    );
    expect(serverRes).toBeDefined();
    expect(serverRes.status).toBe(200);
    expect("json" in serverRes && serverRes.json).toBeTruthy();
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
