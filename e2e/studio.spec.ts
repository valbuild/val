import { expect, test, type Page } from "@playwright/test";

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

async function waitForStudio(page: Page): Promise<void> {
  await page.goto("/val");
  // Intake, not a load event: the SPA bundle has to run, fetch its schema and
  // sources, and take the project in. `__VAL_STORES__` is set by the provider
  // once that is done.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bag = window as unknown as {
            __VAL_STORES__?: { received: boolean };
          };
          return bag.__VAL_STORES__?.received === true;
        }),
      {
        timeout: 60_000,
        message: "the store system never took the project in",
      },
    )
    .toBe(true);
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
  /**
   * Start from a clean chain.
   *
   * `examples/next/.val` is a fixture directory, gitignored and owned by whoever
   * is running the example app — which, for the length of this suite, is this
   * suite. Without the reset the patch chain grows by four on every run, `/stat`
   * gets slower, and eventually a test fails for a reason that has nothing to do
   * with the code under test.
   *
   * It is a `beforeAll`, not a `beforeEach`: the tests are written to be relative
   * to whatever they find (see the discard test, which compares against the value
   * it read rather than against the committed source), so they compose, and
   * resetting between them would only hide an ordering bug.
   */
  test.beforeAll(async ({ request }) => {
    const listed = await request.get("/api/val/patches");
    expect(listed.ok()).toBe(true);
    const body = (await listed.json()) as { patches: { patchId: string }[] };
    if (body.patches.length === 0) return;
    const query = body.patches
      .map((patch) => `id=${encodeURIComponent(patch.patchId)}`)
      .join("&");
    const deleted = await request.delete(`/api/val/patches?${query}`);
    expect(deleted.ok(), "could not clear the example app's patch chain").toBe(
      true,
    );
  });

  test("takes the real project in and can name a write parent", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await waitForStudio(page);
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
    await waitForStudio(page);

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
      if (res.status !== "created") {
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
    await waitForStudio(page);

    const rendered = await page.evaluate(async () => {
      const bag = window as unknown as {
        __VAL_STORE_PROBE__: (path: string) => void;
        __VAL_STORES__: {
          system: {
            patchStore: {
              createPatch(mfp: string, patch: unknown[]): Promise<unknown>;
            };
          };
        };
      };
      await bag.__VAL_STORES__.system.patchStore.createPatch(
        "/content/authors.val.ts",
        [{ op: "replace", path: ["teddy", "name"], value: "Shown by e2e" }],
      );
      // Drive the probe component, which reads through `useSourceAtPath` — the
      // same hook a real field uses.
      bag.__VAL_STORE_PROBE__('/content/authors.val.ts?p="teddy"."name"');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const root = document.getElementById("val-shadow-root");
      const scope = root?.shadowRoot ?? document;
      const el = scope.querySelector("[data-val-store-probe]");
      return el?.getAttribute("data-val-store-probe") ?? null;
    });

    expect(rendered).toBeTruthy();
    const parsed = JSON.parse(rendered as string) as {
      source: { status: string; data?: unknown };
      validation: string;
    };
    expect(parsed.source).toMatchObject({
      status: "success",
      data: "Shown by e2e",
    });
    // And the module validated, which is the other half of a field being ready.
    expect(parsed.validation).toBe("validated");
  });

  /**
   * Discard takes it back. The counterpart to the publish/discard asymmetry the
   * unit tests pin: here it is asserted against a real server, which is the only
   * place `DELETE /patches` exists.
   */
  test("discards a patch and the value returns", async ({ page }) => {
    await waitForStudio(page);

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
