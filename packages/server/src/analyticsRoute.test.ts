import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { fakeRequest } from "./fakeRequest";
import { InMemoryPatchStore } from "./ValOpsMemory";

/**
 * `POST /analytics` outside Val's hosting: it checks what it is sent and
 * counts nothing. The endpoint takes anyone's POST, so the checks are the
 * point -- the hosted loader answers before this does, but it reads the same
 * format.
 *
 * Driven through the router, because how a `text/plain` body reaches the
 * route is part of what is under test.
 */
describe("/analytics", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();

  const post = async (json: unknown) => {
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
          versions: { core: "0.0.0-test", next: "0.0.0-test" },
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
        method: "POST",
        url: new URL(`http://localhost:3000${route}/analytics`),
        headers: new Headers({ "Content-Type": "text/plain;charset=UTF-8" }),
        json,
      }),
    );
    return { status: res.status, json: "json" in res ? res.json : undefined };
  };

  const beacon = {
    v: 1,
    route: "/blogs/a",
    view: { device: "desktop" },
    rendered: { "/content/blog.val.ts": ['"a"."title"'] },
    viewed: {},
  };

  test("a valid beacon is answered, and not counted", async () => {
    expect(await post(beacon)).toEqual({
      status: 200,
      json: { counted: false },
    });
  });

  test("a newer format is not an error", async () => {
    expect(await post({ v: 2, anything: true })).toEqual({
      status: 200,
      json: { counted: false },
    });
  });

  test("a body with no version is not a beacon", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post([])).status).toBe(400);
  });

  test("more paths than a beacon may carry is refused", async () => {
    const paths = Array.from({ length: 201 }, (_, i) => `${i}`);
    expect(
      (await post({ ...beacon, rendered: { "/content/list.val.ts": paths } }))
        .status,
    ).toBe(400);
    expect(
      (
        await post({
          ...beacon,
          rendered: { "/content/a.val.ts": paths.slice(0, 101) },
          viewed: { "/content/a.val.ts": paths.slice(0, 100) },
        })
      ).status,
    ).toBe(400);
  });

  test("an over-long path, version or referrer is refused", async () => {
    expect(
      (
        await post({
          ...beacon,
          rendered: { "/content/a.val.ts": ["x".repeat(1025)] },
        })
      ).status,
    ).toBe(400);
    expect((await post({ ...beacon, cv: "c".repeat(129) })).status).toBe(400);
    expect(
      (
        await post({
          ...beacon,
          view: { device: "desktop", ref: "r".repeat(254) },
        })
      ).status,
    ).toBe(400);
  });
});
