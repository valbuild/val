import { expect, type Browser, type Page } from "@playwright/test";
import { contextAs, openHttpStudio, type UserKey } from "./httpMode";

/**
 * The rule: **what an open Studio shows is what a reload would show.**
 *
 * A reload is the one thing every user reaches for when the screen looks
 * wrong, so a Studio that only becomes right after one has been showing
 * something false in the meantime — a value that is not the draft, a change
 * hidden that will publish, or one shown that will not. The only change a
 * reload is allowed to bring is a new SCHEMA, and that is announced and asked
 * for rather than slipped in.
 *
 * So the test of it is literal: open a second, fresh page as the same user and
 * compare what the two show. Fresh is the reference because it is built from
 * the server alone, with no history in this session to be wrong about.
 */

/** What a page shows, in the terms a user could tell apart. */
export type Showing = {
  /** Every module's displayed source. */
  sources: Record<string, unknown>;
  /** Pending changes, which are the ones a publish would ship. */
  pending: string[];
};

type Bag = {
  __VAL_STORES__?: {
    received: boolean;
    system: {
      sourceStore: { allSources(): Record<string, unknown> };
      patchStore: {
        allRecords(): { patchId: string; appliedAt?: unknown }[];
        pendingAmong(patchIds: Iterable<string>): Set<string>;
        chainSettled(): boolean;
      };
    };
  };
};

/** What this page shows right now. */
export function showing(page: Page): Promise<Showing> {
  return page.evaluate(() => {
    const stores = (window as unknown as Bag).__VAL_STORES__;
    if (stores === undefined) throw new Error("no stores on this page");
    const { system } = stores;
    // The store's own answer to "has this shipped", which also counts what
    // this tab's publish shipped before any record says so — what a publish
    // from here would leave out.
    const chain = system.patchStore
      .allRecords()
      .map((record) => record.patchId);
    const stillPending = system.patchStore.pendingAmong(chain);
    const pending = chain.filter((patchId) => stillPending.has(patchId));
    return {
      // Through JSON so the comparison is of values, not of identities.
      sources: JSON.parse(JSON.stringify(system.sourceStore.allSources())),
      pending,
    };
  });
}

/** Has the page finished taking the server's answer in? */
function settled(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const stores = (window as unknown as Bag).__VAL_STORES__;
    if (stores === undefined || !stores.received) return false;
    const { system } = stores;
    return system.patchStore.chainSettled();
  });
}

/** The keys on which two snapshots differ, with both sides, for a failure. */
function differences(live: Showing, fresh: Showing): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["pending"] as const) {
    if (JSON.stringify(live[key]) !== JSON.stringify(fresh[key])) {
      out[key] = { live: live[key], reload: fresh[key] };
    }
  }
  const modules = new Set([
    ...Object.keys(live.sources),
    ...Object.keys(fresh.sources),
  ]);
  for (const module of modules) {
    const a = JSON.stringify(live.sources[module]);
    const b = JSON.stringify(fresh.sources[module]);
    if (a !== b) out[module] = { live: a, reload: b };
  }
  return out;
}

const marked = new WeakSet<Page>();

/**
 * Remember that this page's state matters from here on.
 *
 * For a test whose live page holds something only a page that was NOT reloaded
 * can have, so a reload under the test (see
 * {@link expectSameAsReload}) fails it rather than passing it.
 */
export async function markLive(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.set(window, "__valReloadMarker", true);
  });
  marked.add(page);
}

/**
 * Assert that `live` shows what a reload would, for `user`.
 *
 * The live page is given time to converge — the rule is that it gets there
 * without a reload, not that it is there in the same millisecond as the server
 * — and is then checked again a moment later, so a page that passes through
 * the right state on its way somewhere else does not pass.
 */
export async function expectSameAsReload(
  browser: Browser,
  live: Page,
  user: UserKey,
  message: string,
): Promise<void> {
  /*
   * The live page must have been marked BEFORE the event under test. `next
   * dev` can full-reload an open page while it compiles for a new one, and a
   * page reloaded between the event and here agrees with the fresh one for
   * the wrong reason — so the marker is required, never created here.
   */
  expect(
    marked.has(live),
    "call markLive(page) before the event this compares, or a reload can pass it",
  ).toBe(true);
  expect(
    await live.evaluate(() => Reflect.get(window, "__valReloadMarker")),
    "the live page was reloaded after it was marked, so it proves nothing",
  ).toBe(true);
  const context = await contextAs(browser, user);
  try {
    const fresh = await context.newPage();
    await openHttpStudio(fresh);
    await expect
      .poll(() => settled(fresh), {
        message: "the reloaded page never settled",
        timeout: 30_000,
      })
      .toBe(true);
    const compare = async () =>
      differences(await showing(live), await showing(fresh));
    await expect
      .poll(compare, {
        message: `${message}: the open Studio shows something a reload does not`,
        timeout: 30_000,
      })
      .toEqual({});
    await live.waitForTimeout(1_500);
    expect(
      await compare(),
      `${message}: the open Studio drifted away from what a reload shows`,
    ).toEqual({});
    expect(
      await live.evaluate(() => Reflect.get(window, "__valReloadMarker")),
      "the live page was reloaded during the comparison, so it proves nothing",
    ).toBe(true);
  } finally {
    await context.close();
  }
}
