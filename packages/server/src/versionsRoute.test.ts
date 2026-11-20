import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { fakeRequest } from "./fakeRequest";
import { InMemoryPatchStore } from "./ValOpsMemory";
import { ValApiOptions } from "./ValRouter";
import { VERSION } from "./version";

/**
 * `GET /versions`, the list at the foot of the Studio's account panel: the
 * framework binding is named by the binding (`versions.framework`), and core
 * and server are this process's own.
 */
describe("/versions", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();

  const get = async (options: Partial<ValApiOptions>) => {
    const handler = createValApiRouter(
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
          patchStore: new InMemoryPatchStore(),
          ...options,
        },
        config,
        {
          async isEnabled() {
            return false;
          },
          async onDisable() {},
          async onEnable() {},
        },
      ),
      (res) => res,
    );
    const res = await handler(
      fakeRequest({
        method: "GET",
        url: new URL(`http://localhost:3000${route}/versions`),
      }),
    );
    return { status: res.status, json: "json" in res ? res.json : undefined };
  };

  test("names the binding the server runs under", async () => {
    expect(
      await get({
        unsafelyAllowUnauthenticated: true,
        versions: { core: "1.2.3", next: "4.5.6", framework: "tanstack" },
      }),
    ).toEqual({
      status: 200,
      json: {
        framework: { name: "tanstack", version: "4.5.6" },
        core: expect.any(String),
        server: VERSION,
      },
    });
  });

  test("names no framework where no binding said which it is", async () => {
    const res = await get({
      unsafelyAllowUnauthenticated: true,
      versions: { core: "1.2.3", next: "4.5.6" },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ framework: null });
  });

  test("is behind the same sign-in as the rest of the Studio", async () => {
    const res = await get({
      valSecret: "a-secret",
      versions: { core: "1.2.3", next: "4.5.6", framework: "next" },
    });
    expect(res.status).toBe(401);
  });
});
