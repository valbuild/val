import { modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";

describe("ValRouter", () => {
  const route = "/api/val";
  const onRoute = createValApiRouter(
    route,
    createValServer(
      modules({}, []),
      route,
      {},
      {
        async isEnabled() {
          return true;
        },
        async onDisable() {},
        async onEnable() {},
      }
    ),
    (res) => res
  );

  test("smoke test valid route: /tree/~", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "PUT",
        url: new URL(
          "http://localhost:3000/api/val/tree/~?validate_all=true&validate_sources=true"
        ),
        json: {},
        headers: new Headers({
          Cookie: `ValidQueryParamTypes=${encodeJwt({}, "")}`,
        }),
      })
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
      })
    );
    console.log(serverRes);
    expect(serverRes).toBeDefined();
    expect(serverRes.status).toBe(200);
    expect("json" in serverRes && serverRes.json).toBeTruthy();
  });

  test("smoke test invalid route", async () => {
    const serverRes = await onRoute(
      fakeRequest({
        method: "PUT",
        url: new URL(
          "http://localhost:3000/api/val/invalid/~?validate_all=true&validate_sources=true"
        ),
        json: {},
        headers: new Headers({
          Cookie: `ValidQueryParamTypes=${encodeJwt({}, "")}`,
        }),
      })
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
