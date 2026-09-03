import fs from "fs";
import os from "os";
import path from "path";
import { initVal, modules } from "@valbuild/core";
import type { SelectorSource, ValModule } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";

/**
 * Draft-mode rendering, scoped to a patch group.
 *
 * `fetchVal` and `useVal` in draft mode do NOT go through the Studio's client
 * stores — they call `PUT /sources/~` and the server replays patches. So the
 * client-side group scoping (`System.setPatchGroup`, covered in
 * `packages/ui/spa/stores/patchGroupPublish.test.ts`) does not reach this path
 * at all, and until `patch_id` existed here a server-rendered draft preview
 * showed base + EVERY pending patch on the branch — including unpublished work
 * by other people, which is the one thing independent publish exists to prevent.
 *
 * The claim held up here: **`/sources/~` applies exactly the patches it is told
 * to, and applies everything only when it is told nothing.**
 *
 * Two authors, two pending patches, one route. Asserted on the source the
 * server actually returns, so this is the same thing a draft render would show.
 */
describe("/sources/~ patch group scoping", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();

  const AUTHORS = "/content/authors.val.ts";
  const authorItemSchema = s.object({ name: s.string() });
  const authorsSchema = s.record(authorItemSchema);
  const authorsSource = {
    freekh: { name: "Fredrik Ekholdt" },
    teddy: { name: "Theodor René Carlsen" },
  };

  /** Alice's edit. */
  const MINE = "11111111-1111-4111-8111-111111111111";
  /** Bob's, which Alice has not staged. */
  const THEIRS = "22222222-2222-4222-8222-222222222222";
  const MY_VALUE = "Fredrik (mine, staged)";
  const THEIR_VALUE = "Theodor (theirs, held back)";

  const createOnRoute = (valModule: ValModule<SelectorSource>) =>
    createValApiRouter(
      route,
      createValServer(
        modules(config, [
          { def: () => Promise.resolve({ default: valModule }) },
        ]),
        route,
        { disableCache: true },
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

  type Authors = Record<string, { name: string }>;

  /**
   * The two patches, then one read of `/sources/~` under `query`.
   *
   * Rooted at a scratch cwd for the reason `ValRouter.test.ts` documents: an
   * fs-mode server writes `.val/patches` under `process.cwd()`, so without this
   * the test leaves a synthetic pending edit in the checkout that every later
   * fs-mode server picks up as its head.
   */
  async function sourcesWith(query: string | undefined): Promise<Authors> {
    const valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-patch-group-"));
    const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(valRoot);
    try {
      const onRoute = createOnRoute(
        c.define(AUTHORS, authorsSchema, authorsSource),
      );
      const cookie = new Headers({
        Cookie: `val_session=${encodeJwt({}, "")}`,
      });

      const patchesRes = await onRoute(
        fakeRequest({
          method: "GET",
          url: new URL("http://localhost:3000/api/val/patches"),
          headers: cookie,
        }),
      );
      const patchesBody =
        patchesRes.status === 200 && "json" in patchesRes
          ? patchesRes.json
          : null;
      if (
        patchesBody === null ||
        typeof patchesBody !== "object" ||
        !("baseSha" in patchesBody) ||
        typeof patchesBody.baseSha !== "string"
      ) {
        throw new Error("Expected the patches response to carry a baseSha");
      }

      const put = await onRoute(
        fakeRequest({
          method: "PUT",
          url: new URL("http://localhost:3000/api/val/patches"),
          json: {
            patches: [
              {
                path: AUTHORS,
                patchId: MINE,
                patch: [
                  { op: "replace", path: ["freekh", "name"], value: MY_VALUE },
                ],
              },
              {
                path: AUTHORS,
                patchId: THEIRS,
                patch: [
                  {
                    op: "replace",
                    path: ["teddy", "name"],
                    value: THEIR_VALUE,
                  },
                ],
              },
            ],
            parentRef: { type: "head", headBaseSha: patchesBody.baseSha },
          },
          headers: cookie,
        }),
      );
      if (put.status !== 200) {
        throw new Error(
          `Expected the patches to be accepted, got ${put.status}`,
        );
      }

      const url = new URL(
        `http://localhost:3000/api/val/sources/~${query ? `?${query}` : ""}`,
      );
      const res = await onRoute(
        fakeRequest({ method: "PUT", url, json: {}, headers: cookie }),
      );
      if (res.status !== 200 || !("json" in res)) {
        throw new Error(`Expected 200 from /sources/~, got ${res.status}`);
      }
      const body = res.json;
      if (
        body === null ||
        typeof body !== "object" ||
        !("modules" in body) ||
        body.modules === null ||
        typeof body.modules !== "object"
      ) {
        throw new Error("Expected /sources/~ to return modules");
      }
      const module = (body.modules as Record<string, { source?: unknown }>)[
        AUTHORS
      ];
      if (!module || typeof module.source !== "object" || !module.source) {
        throw new Error(`Expected a source for ${AUTHORS}`);
      }
      return module.source as Authors;
    } finally {
      cwdSpy.mockRestore();
      fs.rmSync(valRoot, { recursive: true, force: true });
    }
  }

  test("applies only the named patch, leaving the other author's at base", async () => {
    const source = await sourcesWith(`patch_id=${MINE}`);

    expect(source.freekh.name).toBe(MY_VALUE);
    // The one that matters: a draft render must not show unpublished work the
    // caller has not staged.
    expect(source.teddy.name).toBe(authorsSource.teddy.name);
  });

  test("naming the other patch is the mirror image", async () => {
    // Same fixture, opposite group. Guards against the first test passing
    // because of an ordering accident rather than because of the filter.
    const source = await sourcesWith(`patch_id=${THEIRS}`);

    expect(source.teddy.name).toBe(THEIR_VALUE);
    expect(source.freekh.name).toBe(authorsSource.freekh.name);
  });

  test("naming both applies both", async () => {
    const source = await sourcesWith(`patch_id=${MINE}&patch_id=${THEIRS}`);

    expect(source.freekh.name).toBe(MY_VALUE);
    expect(source.teddy.name).toBe(THEIR_VALUE);
  });

  test("naming nothing still applies everything", async () => {
    // Every existing caller — and every older client — sends no `patch_id`.
    // If this ever regressed to "apply nothing", draft mode would silently
    // stop showing anybody their own unpublished work.
    const source = await sourcesWith(undefined);

    expect(source.freekh.name).toBe(MY_VALUE);
    expect(source.teddy.name).toBe(THEIR_VALUE);
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
