import { expect, test, type Page } from "@playwright/test";
import { clearPatchChain, openStudio } from "./studio";

/**
 * The Studio, driven the way an editor drives it.
 *
 * Every assertion here is about something a unit test cannot reach. Three of the
 * four worst bugs in this migration were invisible to the whole jest suite:
 *
 * - a `StrictMode` effect cleanup that disposed the store graph, so the system
 *   took modules in and then ignored every event. No test remounts a provider.
 * - four AI write paths that applied edits locally and saved nothing, reporting
 *   success. No test exercised them.
 * - an `await` in the write path that moved the engine's source a microtask late.
 *   Caught by a test, but only because one existed by then.
 *
 * What they have in common is that they need a real browser, a real server and a
 * real project at once. That is what this file is.
 *
 * ## What it deliberately does NOT do
 *
 * It does not assert on the Studio's DOM structure beyond what an editor would
 * recognise — a field, a value, a button. The Studio's markup is the least stable
 * thing in this repository, and a test that breaks when a class name changes is a
 * test people delete.
 */

/** The store system, reachable from the page. See `ValStoreShadow`. */
type StoreProbe = {
  loadedModules: string[];
  received: boolean;
  parentRef: unknown;
  pending: string[];
};

/**
 * Console errors this environment produces on its own, and why each is not the
 * app's problem. The list is deliberately explicit: `toEqual([])` on a dev-mode
 * page is a test nobody can keep passing, but an unexplained `filter` is a test
 * that hides real regressions. Every entry here is a claim that has been checked.
 */
const ALLOWED_CONSOLE_ERRORS: { match: RegExp; why: string }[] = [
  {
    // The Studio's stylesheet asks for DM Sans and Space Grotesk. Outbound HTTPS
    // in a sandboxed runner goes through a proxy whose CA the browser does not
    // trust, so the request fails before it reaches Google.
    match: /ERR_CERT_AUTHORITY_INVALID/,
    why: "Google Fonts, blocked by the sandbox proxy's certificate",
  },
  {
    // `/api/val/ai/*` needs a personal access token, which a local dev checkout
    // has no reason to have. The server says so plainly in its own log:
    // "Could not read personal access token file".
    match: /\/api\/val\/ai\//,
    why: "the AI endpoints are unauthenticated in a local checkout",
  },
  {
    match: /Could not read personal access token file/,
    why: "the same missing token, reported by the server",
  },
];

/**
 * A console error, with the resource it came from.
 *
 * Both halves are needed. A failed request logs only "Failed to load resource:
 * the server responded with a status of 401 (Unauthorized)" as its text — the
 * URL that failed lives in the message's location, so text alone cannot tell an
 * unauthenticated AI endpoint from an unauthenticated anything.
 */
type ConsoleError = { text: string; url: string };

function collectConsoleErrors(page: Page): ConsoleError[] {
  const errors: ConsoleError[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on("pageerror", (error) =>
    errors.push({ text: error.message, url: "" }),
  );
  return errors;
}

function unexplained(errors: readonly ConsoleError[]): ConsoleError[] {
  return errors.filter(
    (error) =>
      !ALLOWED_CONSOLE_ERRORS.some(
        ({ match }) => match.test(error.text) || match.test(error.url),
      ),
  );
}

async function probe(page: Page): Promise<StoreProbe> {
  return page.evaluate(() => {
    const bag = window as unknown as {
      __VAL_STORES__?: {
        received: boolean;
        system: {
          sourceStore: { loadedModules(): string[] };
          patchStore: { pendingPatchIds(): string[] };
          patchSync: { currentParentRef(): unknown };
        };
      };
    };
    const held = bag.__VAL_STORES__;
    if (held === undefined) {
      throw new Error("no store system on the page");
    }
    return {
      loadedModules: held.system.sourceStore.loadedModules(),
      received: held.received,
      parentRef: held.system.patchSync.currentParentRef(),
      pending: held.system.patchStore.pendingPatchIds(),
    };
  });
}

test.describe("the Studio runs on the store system", () => {
  // Start from a clean chain. See `clearPatchChain`.
  //
  // A `beforeAll`, not a `beforeEach`: these tests are written to be relative to
  // whatever they find (see the discard test, which compares against the value it
  // read rather than against the committed source), so they compose, and
  // resetting between them would only hide an ordering bug.
  test.beforeAll(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("takes the real project in and can name a write parent", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await openStudio(page);
    const seen = await probe(page);

    // A real project, not a fixture.
    expect(seen.loadedModules.length).toBeGreaterThan(5);
    expect(seen.loadedModules).toContain("/content/authors.val.ts");
    // `parentRef` is the assertion that `/stat` reached the store system. Without
    // it every write reports itself unsaveable — which is exactly what happened
    // when a `StrictMode` cleanup had disposed the graph, and the symptom was a
    // null here.
    expect(seen.parentRef).not.toBeNull();
    expect(unexplained(errors)).toEqual([]);
  });

  /**
   * A write, end to end: through the store, to the server, and back out of a
   * fresh request. The last part matters — asserting the client's own state would
   * pass for a client that never sent anything, which is the bug this replaces.
   */
  test("writes a patch that the server actually has", async ({
    page,
    request,
  }) => {
    await openStudio(page);

    const patchId = await page.evaluate(async () => {
      const bag = window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              createPatch(
                mfp: string,
                patch: unknown[],
              ): Promise<
                | { status: "created"; record: { patchId: string } }
                | { status: string; message: string }
              >;
            };
            patchSync: { flush(): Promise<void> };
          };
        };
      };
      const system = bag.__VAL_STORES__.system;
      const res = await system.patchStore.createPatch(
        "/content/authors.val.ts",
        [{ op: "replace", path: ["teddy", "name"], value: "Edited by e2e" }],
      );
      // `in`, not a status check: the failure branch's `status` is a plain
      // `string` here, so it overlaps `"created"` and TypeScript cannot narrow
      // on it. Nothing in CI typechecks `e2e/` — `pnpm run -r typecheck` is
      // per-package and this is at the root — so a cast would have hidden it
      // until the suite failed at runtime with something unrelated-looking.
      if (!("record" in res)) {
        throw new Error(`createPatch failed: ${JSON.stringify(res)}`);
      }
      await system.patchSync.flush();
      return res.record.patchId;
    });

    // Nothing pending: the store had it acknowledged.
    await expect.poll(async () => (await probe(page)).pending.length).toBe(0);

    // And the SERVER has it. A separate request, so this cannot pass on client
    // state alone.
    const res = await request.get("/api/val/patches?exclude_patch_ops=false");
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      patches: { patchId: string; patch: unknown[] }[];
    };
    const found = body.patches.find((patch) => patch.patchId === patchId);
    expect(
      found,
      "the patch the store wrote is not on the server",
    ).toBeTruthy();
    expect(found?.patch).toEqual([
      { op: "replace", path: ["teddy", "name"], value: "Edited by e2e" },
    ]);
  });

  /**
   * The value the editor sees moves, and moves for the right reason: the patch
   * applied to source rather than the field happening to re-render.
   */
  test("shows the written value through the hooks", async ({ page }) => {
    await openStudio(page);

    /**
     * Unique per run, so the assertion cannot be satisfied by anything already
     * in the chain.
     *
     * This suite composes on purpose, and the test before this one writes to the
     * same field. A fixed string would still be the right assertion — the two
     * values differ — but it makes the FAILURE ambiguous: seeing the earlier
     * test's value here could mean this write never landed, or that it landed
     * and was somehow undone. A value no earlier run could have produced settles
     * that: whatever the probe shows instead, it is a value that was already
     * there.
     */
    const written = `Shown by e2e ${Date.now()}`;

    await page.evaluate(async (value) => {
      const bag = window as unknown as {
        __VAL_STORE_PROBE__: (path: string) => void;
        __VAL_STORES__: {
          system: {
            patchStore: {
              /**
               * Declared as one shape rather than as a union of the success and
               * failure results, for the reason the sibling test above spells
               * out: the failure branch's `status` is a plain `string`, so it
               * overlaps `"created"` and TypeScript cannot narrow on it — a
               * union here would only make `message` unreachable on the branch
               * that carries it.
               */
              createPatch(
                mfp: string,
                patch: unknown[],
              ): Promise<{ status: string; message?: string }>;
            };
          };
        };
      };
      const res = await bag.__VAL_STORES__.system.patchStore.createPatch(
        "/content/authors.val.ts",
        [{ op: "replace", path: ["teddy", "name"], value }],
      );
      /**
       * Checked, because the alternative is a twenty-second silence.
       *
       * `createPatch` reports a refused write in its return value rather than by
       * throwing. Ignoring it meant a write that never happened was indis-
       * tinguishable from one still in flight: the probe kept showing whatever
       * was there before, the poll below ran out its timeout, and the report was
       * a value mismatch with no mention of the store having said no. The
       * message it carries is the actual diagnosis, so it belongs in the
       * failure.
       */
      if (res.status !== "created") {
        throw new Error(
          `the store refused the write: ${res.message ?? res.status}`,
        );
      }
      // Drive the probe component, which reads through `useSourceAtPath` — the
      // same hook a real field uses.
      bag.__VAL_STORE_PROBE__('/content/authors.val.ts?p="teddy"."name"');
    }, written);

    /**
     * Polled, not slept on.
     *
     * A patch marks validation stale and the READ is what recomputes it, on a
     * real worker — which on first use has to be fetched and compiled. A fixed
     * wait was long enough while validation ran in-process and became a flake
     * the moment it moved to a thread, which is the wrong reason for a test to
     * fail. See `schemaValidationBridge.ts`.
     */
    const read = async () =>
      page.evaluate(() => {
        const root = document.getElementById("val-shadow-root");
        const scope = root?.shadowRoot ?? document;
        const el = scope.querySelector("[data-val-store-probe]");
        const raw = el?.getAttribute("data-val-store-probe");
        return raw === undefined || raw === null
          ? null
          : (JSON.parse(raw) as {
              source: { status: string; data?: unknown };
              validation: string;
            });
      });

    await expect
      .poll(async () => (await read())?.source, {
        message: "the probe never rendered the written value",
      })
      .toMatchObject({ status: "success", data: written });
    // And the module validated, which is the other half of a field being ready.
    await expect
      .poll(async () => (await read())?.validation, {
        message: "the module never finished validating",
      })
      .toBe("validated");

    /**
     * Confirmed reaching the server before this test's page closes.
     *
     * The write above is debounced client-side, and Playwright tears the page
     * down the moment this test returns — with nothing forcing the flush,
     * whether that write lands before or after depends on how much real
     * wall-clock time happened to pass, which is exactly the kind of race that
     * only shows up under full-suite load. This suite composes on purpose (see
     * the `beforeAll` above): later tests read this file's writes back out of
     * the chain, and a write is not really "done" until the server has it.
     */
    await page.evaluate(async () => {
      const bag = window as unknown as {
        __VAL_STORES__: { system: { patchSync: { flush(): Promise<void> } } };
      };
      await bag.__VAL_STORES__.system.patchSync.flush();
    });
    await expect.poll(async () => (await probe(page)).pending.length).toBe(0);
  });

  /**
   * An image upload, with a non-empty chain.
   *
   * The chain state is the whole test. `ValOpsFS` writes a patch's bytes into the
   * directory named by its parentRef and reads them back out of the directory the
   * PATCH ended up in — so while the chain is empty both are `head/` and a
   * hardcoded head parentRef looks correct. It was hardcoded, and every image
   * upload after the first patch put its bytes somewhere nothing would ever look:
   * `GET /api/val/files/...?patch_id=` answered 404 and the editor saw a broken
   * image with no error anywhere.
   *
   * Nothing short of this catches it: the unit test pins which parentRef the
   * store passes, but only a real server has the two directories.
   */
  test("uploads an image the server can read back", async ({
    page,
    request,
  }) => {
    await openStudio(page);

    const written = await page.evaluate(async () => {
      const bag = window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              createPatch(
                mfp: string,
                patch: unknown[],
                meta?: unknown,
                fieldId?: string,
                onProgress?: unknown,
                withPatchId?: string,
                sessionId?: string,
                fileType?: "image" | "file",
              ): Promise<{
                status: string;
                record?: { patchId: string };
                message?: string;
              }>;
            };
            patchSync: { flush(): Promise<void>; currentParentRef(): unknown };
          };
        };
      };
      const system = bag.__VAL_STORES__.system;
      // A text patch first, so the chain's parent is a PATCH rather than the
      // head. Without this the test passes with the bug in place.
      await system.patchStore.createPatch("/content/authors.val.ts", [
        { op: "replace", path: ["teddy", "name"], value: "chain not empty" },
      ]);
      await system.patchSync.flush();

      // A 1x1 transparent PNG.
      const png =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const res = await system.patchStore.createPatch(
        "/content/media.val.ts",
        [
          {
            op: "add",
            path: ["/public/val/images/e2e-probe.png"],
            value: { width: 1, height: 1, mimeType: "image/png", alt: null },
          },
          {
            op: "file",
            path: ["/public/val/images/e2e-probe.png"],
            filePath: "/public/val/images/e2e-probe.png",
            value: png,
            metadata: { width: 1, height: 1, mimeType: "image/png" },
            remote: false,
          },
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "image",
      );
      await system.patchSync.flush();
      return {
        status: res.status,
        message: res.message,
        patchId: res.record?.patchId ?? null,
        parentRef: system.patchSync.currentParentRef(),
      };
    });

    expect(written.status, written.message ?? "").toBe("created");
    expect(written.parentRef).toMatchObject({ type: "patch" });

    // The bytes, through the endpoint the Studio uses for a draft file.
    const file = await request.get(
      `/api/val/files/public/val/images/e2e-probe.png?patch_id=${written.patchId}`,
    );
    expect(
      file.status(),
      "the uploaded bytes are not where the patch's directory is",
    ).toBe(200);
    expect((await file.body()).length).toBeGreaterThan(20);
  });

  /**
   * Discard takes it back. The counterpart to the publish/discard asymmetry the
   * unit tests pin: here it is asserted against a real server, which is the only
   * place `DELETE /patches` exists.
   */
  test("discards a patch and the value returns", async ({ page }) => {
    await openStudio(page);

    /*
     * Wait for the chain this page loaded WITH to be applied, before reading
     * anything.
     *
     * The assertion below is relative to the value at the start of this test,
     * and the earlier tests in this file left patches on `teddy.name` — so the
     * value read here is only meaningful once those have landed. `openStudio`
     * waits for intake, which is a fetch earlier than that: read too soon and
     * `before` is the committed value, the discard rebuilds source from base
     * plus the surviving chain, and the test fails claiming a discard changed a
     * field it never touched.
     */
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bag = window as unknown as {
              __VAL_STORES__?: {
                system: { patchStore: { chainSettled(): boolean } };
              };
            };
            return (
              bag.__VAL_STORES__?.system.patchStore.chainSettled() ?? false
            );
          }),
        { message: "the loaded patch chain never finished applying" },
      )
      .toBe(true);

    const before = await page.evaluate(() => {
      const bag = window as unknown as {
        __VAL_STORES__: {
          system: {
            sourceStore: {
              peek(path: string): {
                status: string;
                data?: unknown;
                revision?: unknown;
              };
            };
          };
        };
      };
      return bag.__VAL_STORES__.system.sourceStore.peek(
        '/content/authors.val.ts?p="teddy"."name"',
      );
    });
    expect(before).toMatchObject({ status: "ready" });

    const after = await page.evaluate(async (previous) => {
      const bag = window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              createPatch(
                mfp: string,
                patch: unknown[],
              ): Promise<{ status: string; record?: { patchId: string } }>;
            };
            patchSync: { flush(): Promise<void> };
            discard(
              ids: string[],
            ): Promise<{ status: string; message?: string }>;
            sourceStore: {
              peek(path: string): {
                status: string;
                data?: unknown;
                revision?: unknown;
              };
            };
          };
        };
      };
      const system = bag.__VAL_STORES__.system;
      const created = await system.patchStore.createPatch(
        "/content/authors.val.ts",
        [
          {
            op: "replace",
            path: ["teddy", "name"],
            value: "will be discarded",
          },
        ],
      );
      if (created.status !== "created" || created.record === undefined) {
        throw new Error("createPatch failed");
      }
      await system.patchSync.flush();
      const res = await system.discard([created.record.patchId]);
      return {
        discard: res,
        value: system.sourceStore.peek(
          '/content/authors.val.ts?p="teddy"."name"',
        ),
        previous,
      };
    }, before);

    expect(after.discard).toMatchObject({ status: "discarded" });
    // Back to the value it had. An applied patch cannot be un-applied, so this can
    // only be right if source was rebuilt from base plus the surviving chain — and
    // note it is `before`, not the module's committed value: the patches the
    // earlier tests wrote are still in the chain and must survive this discard.
    expect(after.value.status).toBe(after.previous.status);
    expect(after.value.data).toEqual(after.previous.data);
    // The revision, though, must NOT match. A discard is a change to the module,
    // and `revision` is what every read hook compares to decide whether to fetch
    // again. A discard that left the revision alone would leave every mounted
    // field showing the discarded value, which is the whole bug this guards.
    expect(after.value.revision).not.toEqual(after.previous.revision);
  });
});
