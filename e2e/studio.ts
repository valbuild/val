import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
// By relative path, not by package name: `e2e/` is not a workspace package, so
// nothing links `@valbuild/*` into a `node_modules` it can resolve from — the
// same reason `e2e/http/httpMode.ts` reaches into `packages/server/src`.
import type { PatchId } from "../packages/core/src";
import { chunkPatchIds } from "../packages/ui/spa/stores/react/patchIdChunks";

/**
 * Shared helpers for the two Studio suites.
 *
 * `studio.spec.ts` drives the store system directly; `studio-ui.spec.ts` clicks
 * and types. Both have to wait for the same intake and start from the same clean
 * patch chain, so those live here rather than twice.
 */

/** Long enough for `next dev` to compile the route on the first test. */
const INTAKE_TIMEOUT = 60_000;

/**
 * Open the Studio and wait for it to take the project in.
 *
 * Intake, not a load event: the SPA bundle has to run, fetch its schema and
 * sources, and adopt the project. `__VAL_STORES__` is set by `ValStoreProvider`
 * once that is done.
 */
export async function openStudio(
  page: Page,
  /**
   * The Studio route to open. Defaults to the root.
   *
   * Takes a route rather than making callers `goto` afterwards, because a second
   * navigation throws away the intake this function waited for — and the failure
   * that produces is a locator finding nothing, which reads as a missing feature
   * rather than as a missing wait.
   */
  route = "/val",
): Promise<void> {
  await page.goto(route);
  /**
   * Next's dev-tools badge, out of the way.
   *
   * `<nextjs-portal>` floats bottom-left — exactly over the Settings cog at the
   * foot of the rail — and intercepts pointer events even though nothing in the
   * Studio put it there. A click that lands on it retries for the length of the
   * test's timeout and fails reporting a missing feature, which is what made
   * `account.spec.ts` and `screens.spec.ts` look broken. `display: none` on the
   * HOST element hides it and everything in its shadow root together — set
   * from the outer document, which is unaffected by the portal's own style
   * isolation — without touching `next.config.js` and so without taking the
   * overlay away from a developer running the app normally.
   */
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
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
        timeout: INTAKE_TIMEOUT,
        message: "the store system never took the project in",
      },
    )
    .toBe(true);
}

/**
 * Throw away every patch on the server, so a run starts where the last one did.
 *
 * `examples/next/.val` is a fixture directory, gitignored and owned by whoever is
 * running the example app — which, for the length of a suite, is the suite.
 * Without this the chain grows on every run, `/stat` gets slower, and eventually
 * a test fails for a reason that has nothing to do with the code under test.
 *
 * ## Chunked, for the same reason the product chunks
 *
 * One `id=` per patch in a single URL is exactly the 431 that
 * `large-patch-chain.spec.ts` exists to pin, and this helper is the one place
 * that would hit it hardest: an interrupted run of that spec leaves 650
 * fabricated patches on disk, so the very next run's cleanup would build a
 * ~30KB query, be refused before the handler saw it, and fail in `beforeEach`
 * — wedging the suite in a state no later cleanup could get out of, because
 * every later cleanup is this same request.
 *
 * `chunkPatchIds` is the product's own splitter (`discardPatches` in
 * `createValSystem.ts` uses it for the same endpoint), so the budget is shared
 * rather than a second guess at the limit. Sequential for the reason that call
 * site gives: each delete changes the chain the next is computed against.
 */
export async function clearPatchChain(
  request: APIRequestContext,
): Promise<void> {
  const listed = await request.get("/api/val/patches");
  expect(listed.ok()).toBe(true);
  const body = (await listed.json()) as { patches: { patchId: string }[] };
  const patchIds = body.patches.map((patch) => patch.patchId as PatchId);
  for (const chunk of chunkPatchIds(patchIds, "id")) {
    const query = chunk
      .map((patchId) => `id=${encodeURIComponent(patchId)}`)
      .join("&");
    const deleted = await request.delete(`/api/val/patches?${query}`);
    expect(deleted.ok(), "could not clear the example app's patch chain").toBe(
      true,
    );
  }
}

/**
 * `test`, but every test using it starts from a clean patch chain.
 *
 * A spec that only reads — a layout measurement, a smoke check, a nav
 * assertion — has no reason to call `clearPatchChain` itself, and that is
 * exactly how one gets skipped: nothing about a spec that never writes a
 * patch suggests it needs to clear one. But every fs-mode spec shares the
 * same `examples/next/.val` directory and runs in the same serial worker
 * (`playwright.config.ts`), so a patch left behind by whichever spec ran
 * before it is still there — an invalid title can make a field's own text
 * assertion fail, a stray media upload can appear in a gallery a test
 * screenshots, and which spec happens to run first decides whether any of
 * that shows up. `auto: true` makes the reset unconditional, so a spec
 * using this `test` cannot forget it either.
 *
 * Specs that build their own chain across several tests on purpose —
 * `studio.spec.ts`'s "operations compose" tests, `large-patch-chain.spec.ts`'s
 * own fabricated fixture — keep importing `test` from `@playwright/test`
 * directly and call `clearPatchChain` on whatever schedule they need.
 */
export const test = base.extend<{ cleanPatches: void }>({
  cleanPatches: [
    async ({ request }, use) => {
      await clearPatchChain(request);
      await use();
    },
    { auto: true },
  ],
});

/**
 * Wait until the SERVER holds no patches.
 *
 * The counterpart to `discardAll`, and the one to reach for after it. `discardAll`
 * already polls the client's chain to zero — it cannot return otherwise — so
 * following it with `expect.poll(() => chainLength(page)).toBe(0)` asserts
 * something that is true by construction at the moment it runs. The only way that
 * follow-up can fail is if the chain goes back UP afterwards, and there is a
 * designed reason it does:
 *
 * `/stat` in `fs` mode long polls on a watcher over `.val/patches`, so deleting
 * the first patch of a chain can wake the poll while the rest are still being
 * removed. The answer then names a patch the server can no longer serve, and
 * `PatchStore` deliberately treats one empty fetch as inconclusive
 * (`notDeliveredOnce`) — an announcement really can be older than a delete — and
 * keeps the record until a later stat settles it. Nothing else writes to the
 * directory by then, so that later stat is a no-change long poll returning after
 * `statPollingInterval` (20s, `ValOpsFS.ts`), against an `expect` timeout that is
 * also 20s. Which of the two 20s timers started first decides the test.
 *
 * So the client is right to hold the record, and the assertion was asking it the
 * wrong question. "Did the discard actually remove them" is a fact about the
 * SERVER, and asking the server is both what the next test depends on and immune
 * to how long the client takes to agree.
 */
export async function expectNoPatchesOnServer(
  request: APIRequestContext,
): Promise<void> {
  await expect
    .poll(
      async () => {
        // `exclude_patch_ops=false` so a leftover can NAME itself. A bare count
        // says "one patch survived the discard" and leaves you guessing which;
        // the module and the ops say whether it is the write the test made or a
        // second one the test never waited for.
        const res = await request.get(
          "/api/val/patches?exclude_patch_ops=false",
        );
        if (!res.ok())
          return [`the server refused the request: ${res.status()}`];
        const body = (await res.json()) as {
          patches: { path?: string; patch?: { op?: string }[] }[];
        };
        return body.patches.map(
          (entry) =>
            `${entry.path ?? "?"} [${(entry.patch ?? [])
              .map((op) => op.op ?? "?")
              .join(",")}]`,
        );
      },
      { message: "the discard left patches on the server" },
    )
    .toEqual([]);
}

/** How many patches the store currently holds, straight from the system. */
export async function chainLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bag = window as unknown as {
      __VAL_STORES__?: { system: { patchStore: { allRecords(): unknown[] } } };
    };
    return bag.__VAL_STORES__?.system.patchStore.allRecords().length ?? 0;
  });
}

/**
 * Throw away every patch the page holds, and wait for the store to agree.
 *
 * Looped rather than one pass over a snapshot of the ids. A write is debounced,
 * so one can land between reading the ids and the discard returning — leaving a
 * patch the discard never knew about, and a chain that never reaches zero. The
 * test that typed the value is not usually the one that fails: the leftover
 * patch is still there when the next spec asserts on the chain, so the failure
 * lands somewhere unrelated and only when the timing happens to line up.
 */
export async function discardAll(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      await discardOnce(page);
      return chainLength(page);
    })
    .toBe(0);
}

async function discardOnce(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bag = window as unknown as {
      __VAL_STORES__: {
        system: {
          discard(ids: string[]): Promise<{ status: string; message?: string }>;
          patchStore: { allRecords(): { patchId: string }[] };
        };
      };
    };
    const system = bag.__VAL_STORES__.system;
    const ids = system.patchStore.allRecords().map((record) => record.patchId);
    if (ids.length === 0) return;
    const res = await system.discard(ids);
    if (res.status !== "discarded") {
      throw new Error(`could not discard: ${res.message ?? res.status}`);
    }
  });
}

/**
 * Open one of the shell's navigation panels.
 *
 * The floating shell keeps navigation behind the left rail rather than always
 * on screen, so a test that wants to click a page has to open the panel first.
 * The rail button and the panel's own header share a name, hence `.first()`.
 */
/**
 * A floating panel, by the title in its header.
 *
 * Settings is one of them: it is not a content destination — it is reached from
 * the cog at the foot of the rail rather than from the strip of three — but it
 * is the same panel with the same close button, so the helpers take it too.
 */
export type PanelName = "Pages" | "Media" | "Data" | "Settings" | "Account";

export async function openNavPanel(
  page: Page,
  panel: PanelName,
): Promise<Locator> {
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: panel }).first().click();
  return studio;
}

/**
 * Expand a row in the Pages panel, by name.
 *
 * Nothing is expanded on mount — a real site map has sections with hundreds of
 * rows — so reaching a nested page means opening the rows above it. A row that
 * is also a page selects itself as well, which is what clicking it does in the
 * app too.
 */
export async function expandRow(studio: Locator, name: string): Promise<void> {
  await studio.getByRole("button", { name, exact: true }).first().click();
}

/**
 * Open the Pages panel and expand the site map down to the top level.
 *
 * The root of the site map is the home page on this project, so every other
 * page is nested under it: without opening `/` there is nothing else to click.
 */
export async function openSiteMap(page: Page): Promise<Locator> {
  const studio = await openNavPanel(page, "Pages");
  await expandRow(studio, "/");
  return studio;
}

/**
 * Close the navigation panel, leaving the editor unobstructed.
 *
 * Not tidiness: an open panel has a filter input of its own, so a test that
 * reaches for "the first input" while one is open can end up typing into the
 * filter. Closing is also what an editor does once they have picked a page.
 */
export async function closeNavPanel(
  studio: Locator,
  panel: PanelName,
): Promise<void> {
  await studio.getByRole("button", { name: `Close ${panel}` }).click();
}

/**
 * The stores the Studio hangs on `window` for tests, typed narrowly.
 *
 * `__VAL_STORES__` is set by `ValStoreProvider` and holds the real system, so a
 * test can drive a store directly rather than clicking its way to a state. What
 * it gets is declared here — only the members the helpers below use — because the
 * alternative is `as any` at every call site, and then nothing catches a store
 * method being renamed under a test that reaches for it.
 *
 * `unknown` for the values crossing back out of the browser: they are structured
 * clones of store state, so a type here would be a claim about a serialisation
 * rather than about the store.
 */
type StudioStores = {
  system: {
    patchStore: {
      createPatch: (
        moduleFilePath: string,
        patch: unknown[],
      ) => Promise<{ patchId: string }>;
    };
    sourceStore: {
      peek: (path: string) => { status: string; data?: unknown };
    };
  };
};

/**
 * Write a patch through the Studio's own store, as if a field had been edited.
 *
 * For the changes a test cannot reasonably produce by typing — a `move`, an `add`
 * at a chosen index, several patches in a known order. It goes through the real
 * `patchStore`, so the chain, the optimistic apply and the sync are all the ones
 * the app uses; only the gesture is skipped.
 */
export async function patchThroughStore(
  page: Page,
  moduleFilePath: string,
  patch: unknown[],
): Promise<void> {
  const failure = await page.evaluate(
    async ([path, ops]) => {
      const bag = window as unknown as { __VAL_STORES__?: StudioStores };
      const system = bag.__VAL_STORES__?.system;
      if (system === undefined) {
        return "the Studio's stores are not on window yet";
      }
      await system.patchStore.createPatch(path as string, ops as unknown[]);
      return null;
    },
    [moduleFilePath, patch] as const,
  );
  if (failure !== null) {
    throw new Error(failure);
  }
}

/**
 * What the Studio's source store says is at a path, without loading anything.
 *
 * `peek`, not `get`, for the reason the store draws that distinction: `get` has a
 * side effect (it fetches an unloaded `.jsonValues()` entry), and a test asserting
 * on state should not be the thing that causes it.
 */
export async function peekThroughStore(
  page: Page,
  path: string,
): Promise<unknown> {
  return page.evaluate((at) => {
    const bag = window as unknown as { __VAL_STORES__?: StudioStores };
    const peeked = bag.__VAL_STORES__?.system.sourceStore.peek(at);
    return peeked === undefined ? null : (peeked.data ?? null);
  }, path);
}
