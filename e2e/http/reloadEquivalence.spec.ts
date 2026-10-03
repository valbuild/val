import { expect, test, type Page } from "@playwright/test";
import {
  contextAs,
  mock,
  openHttpStudio,
  publishAll,
  sessionCookie,
  writePatch,
} from "./httpMode";
import { expectSameAsReload, markLive } from "./reloadEquivalence";
import { actOnFirstRow, openReview } from "./staging";

/**
 * An open Studio shows what a reload would — after each thing that can happen
 * to it from somewhere else.
 *
 * See `reloadEquivalence.ts` for the rule and how it is checked. Each test
 * here is one way the server's state can move while a Studio is open: another
 * browser of the same user, another user, a publish. The assertion is the
 * same every time, which is the point — a divergence anywhere is the same bug.
 */

const AUTHORS = "/content/authors.val.ts";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.beforeEach(async () => {
  await mock.reset();
  await mock.enablePatchGroups();
});

test("a change Ada writes in another browser", async ({ page, browser }) => {
  /*
   * Ada already has a change of her own here, so this page is scoped to her
   * group. A page with an empty chain never learns the deployment has groups
   * and shows everything — which agrees with a reload for the wrong reason.
   */
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["freekh", "name"], value: "Ada, here" },
  ]);
  const other = await contextAs(browser, "ada");
  try {
    const elsewhere = await other.newPage();
    await openHttpStudio(elsewhere);
    await markLive(page);
    await writePatch(elsewhere, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "from another browser" },
    ]);
    await expectSameAsReload(browser, page, "ada", "Ada's other browser wrote");
  } finally {
    await other.close();
  }
});

test("a change another user writes", async ({ page, browser }) => {
  // Scoped, as above: Linus's change has to be held back here, not shown.
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["freekh", "name"], value: "Ada, here" },
  ]);
  const linus = await contextAs(browser, "linus");
  try {
    const theirs = await linus.newPage();
    await openHttpStudio(theirs);
    await markLive(page);
    await writePatch(theirs, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Linus, pending" },
    ]);
    await expectSameAsReload(browser, page, "ada", "Linus wrote");
  } finally {
    await linus.close();
  }
});

test("a change another user publishes, before it is built", async ({
  page,
  browser,
}) => {
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["freekh", "name"], value: "Ada, pending" },
  ]);
  const linus = await contextAs(browser, "linus");
  try {
    const theirs = await linus.newPage();
    await openHttpStudio(theirs);
    await markLive(page);
    await writePatch(theirs, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Linus, published" },
    ]);
    // Asserted, because `publishAll` reports a refusal rather than throwing,
    // and two pages agreeing on an unpublished draft would pass this test.
    expect(await publishAll(theirs, "Linus ships")).toMatchObject({
      status: "published",
    });
    await expectSameAsReload(browser, page, "ada", "Linus published");
  } finally {
    await linus.close();
  }
});

test("Ada's own publish, before it is built", async ({ page, browser }) => {
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["teddy", "name"], value: "Ada, published" },
  ]);
  await markLive(page);
  expect(await publishAll(page, "Ada ships")).toMatchObject({
    status: "published",
  });
  await expectSameAsReload(browser, page, "ada", "Ada published");
});

test("Ada's own publish, seen from her other browser", async ({
  page,
  browser,
}) => {
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["teddy", "name"], value: "Ada, first" },
  ]);
  const other = await contextAs(browser, "ada");
  try {
    const elsewhere = await other.newPage();
    await openHttpStudio(elsewhere);
    await openHttpStudio(page);
    await markLive(page);
    expect(
      await publishAll(elsewhere, "Ada ships from the other browser"),
    ).toMatchObject({ status: "published" });
    await expectSameAsReload(
      browser,
      page,
      "ada",
      "Ada published from her other browser",
    );
  } finally {
    await other.close();
  }
});

test("Ada's own publish never takes it off the screen of her other browser", async ({
  page,
  browser,
}) => {
  /*
   * The publish takes Ada's patches out of her group, closes it and marks them
   * applied, in one step, and the websocket tells this page about all three.
   * The site still serves the build from before the publish, so the change has
   * to stay on screen from the chain.
   *
   * Sampled the whole time rather than compared once at the end: when this page
   * took the new groups with the OLD applied list it showed the pre-publish
   * value -- and `expectSameAsReload` above still passed, because the `/stat`
   * poll that follows a commit put it back within seconds. On a project that
   * publishes as jobs nothing put it back until a reload.
   */
  const NAME = "Ada, never reverted";
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["teddy", "name"], value: NAME },
  ]);
  const other = await contextAs(browser, "ada");
  try {
    const elsewhere = await other.newPage();
    await openHttpStudio(elsewhere);
    await markLive(page);
    // What this page shows for the edited field, read straight off the store.
    const shown = () =>
      page.evaluate(
        ({ module }) => {
          const stores = Reflect.get(window, "__VAL_STORES__") as {
            system: {
              sourceStore: { allSources(): Record<string, unknown> };
            };
          };
          const authors = stores.system.sourceStore.allSources()[module] as
            | { teddy?: { name?: unknown } }
            | undefined;
          return authors?.teddy?.name;
        },
        { module: AUTHORS },
      );
    await expect.poll(shown, { timeout: 30_000 }).toBe(NAME);
    // From here on, every value the field takes is recorded.
    await page.evaluate(
      ({ module }) => {
        const seen = new Set<unknown>();
        Reflect.set(window, "__valSeenNames", seen);
        const sample = () => {
          const stores = Reflect.get(window, "__VAL_STORES__") as {
            system: {
              sourceStore: { allSources(): Record<string, unknown> };
            };
          };
          const authors = stores.system.sourceStore.allSources()[module] as
            | { teddy?: { name?: unknown } }
            | undefined;
          seen.add(authors?.teddy?.name);
        };
        sample();
        setInterval(sample, 20);
      },
      { module: AUTHORS },
    );
    expect(
      await publishAll(elsewhere, "Ada ships from the other browser"),
    ).toMatchObject({ status: "published" });
    // Until this page has heard of the publish: the patch reads as shipped.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const stores = Reflect.get(window, "__VAL_STORES__") as {
              system: {
                patchStore: {
                  allRecords(): { patchId: string }[];
                  pendingAmong(ids: Iterable<string>): Set<string>;
                };
              };
            };
            const ids = stores.system.patchStore
              .allRecords()
              .map((record) => record.patchId);
            return stores.system.patchStore.pendingAmong(ids).size;
          }),
        { timeout: 30_000 },
      )
      .toBe(0);
    await page.waitForTimeout(1_000);
    expect(
      await page.evaluate(() => [
        ...(Reflect.get(window, "__valSeenNames") as Set<unknown>),
      ]),
      "the open Studio showed something other than the published value",
    ).toEqual([NAME]);
    /*
     * And the next edit does not take the published change along. Read as
     * unstaged, it was a predecessor of every later edit to its module, and the
     * Studio said "1 change was added to your changes" about work that was
     * already published.
     */
    await page.evaluate(() => {
      const widened: string[][] = [];
      Reflect.set(window, "__valWidened", widened);
      const stores = Reflect.get(window, "__VAL_STORES__") as {
        system: {
          patchSync: {
            events: {
              on(
                type: string,
                listener: (event: { type: string; patches: string[] }) => void,
              ): unknown;
            };
          };
        };
      };
      stores.system.patchSync.events.on("patch:group-widened", (event) => {
        widened.push(event.patches);
      });
    });
    await writePatch(page, AUTHORS, [
      { op: "replace", path: ["freekh", "name"], value: "Ada, after" },
    ]);
    expect(
      await page.evaluate(() => Reflect.get(window, "__valWidened")),
      "the edit after the publish pulled published changes into Ada's",
    ).toEqual([]);
    await expectSameAsReload(browser, page, "ada", "Ada published elsewhere");
  } finally {
    await other.close();
  }
});

function studioOf(page: Page) {
  return page.locator("#val-shadow-root");
}

test("a change Ada stages in another browser", async ({ page, browser }) => {
  // Ada has a group, and Linus has a change she can stage into it.
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["freekh", "name"], value: "Ada, pending" },
  ]);
  const linus = await contextAs(browser, "linus");
  const other = await contextAs(browser, "ada");
  try {
    const theirs = await linus.newPage();
    await openHttpStudio(theirs);
    await writePatch(theirs, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Linus, staged by Ada" },
    ]);
    await linus.close();

    const elsewhere = await other.newPage();
    await openHttpStudio(elsewhere);
    await openHttpStudio(page);
    await markLive(page);
    await openReview(elsewhere, studioOf(elsewhere));
    await actOnFirstRow(
      studioOf(elsewhere),
      "Stage",
      "Linus's change was not offered for staging",
    );
    await expectSameAsReload(
      browser,
      page,
      "ada",
      "Ada staged in her other browser",
    );
  } finally {
    await other.close();
  }
});

test("a change Ada unstages in another browser", async ({ page, browser }) => {
  await openHttpStudio(page);
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["teddy", "name"], value: "Ada, then unstaged" },
  ]);
  const other = await contextAs(browser, "ada");
  try {
    const elsewhere = await other.newPage();
    await openHttpStudio(elsewhere);
    await openHttpStudio(page);
    await markLive(page);
    await openReview(elsewhere, studioOf(elsewhere));
    await actOnFirstRow(
      studioOf(elsewhere),
      "Unstage",
      "Ada's change was not offered for unstaging",
    );
    await expectSameAsReload(
      browser,
      page,
      "ada",
      "Ada unstaged in her other browser",
    );
  } finally {
    await other.close();
  }
});

test("a change re-staged elsewhere after this browser unstaged it", async ({
  page,
  browser,
}) => {
  /*
   * This browser's unstage is remembered so that a STALE annotation cannot
   * undo it. A later stage made elsewhere is not stale, and a reload shows it.
   */
  const other = await contextAs(browser, "ada");
  const linus = await contextAs(browser, "linus");
  try {
    // Every page opened up front, so `next dev` is done compiling before
    // anything here depends on `page` not having been reloaded.
    const elsewhere = await other.newPage();
    await openHttpStudio(elsewhere);
    const theirs = await linus.newPage();
    await openHttpStudio(theirs);
    await openHttpStudio(page);

    await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Ada, back and forth" },
    ]);
    await openReview(page, studioOf(page));
    await actOnFirstRow(
      studioOf(page),
      "Unstage",
      "Ada's change was not offered for unstaging",
    );
    await markLive(page);

    // The other browser has never seen the change staged, so it reads the
    // group fresh and stages it back.
    await openHttpStudio(elsewhere);
    await openReview(elsewhere, studioOf(elsewhere));
    await actOnFirstRow(
      studioOf(elsewhere),
      "Stage",
      "Ada's change was not offered for staging again",
    );
    // A write elsewhere makes `page` fetch, which brings the annotation.
    await writePatch(theirs, AUTHORS, [
      { op: "replace", path: ["freekh", "name"], value: "Linus, unrelated" },
    ]);
    await expectSameAsReload(
      browser,
      page,
      "ada",
      "Ada re-staged in her other browser",
    );
  } finally {
    await linus.close();
    await other.close();
  }
});

test("a change staged while Ada has no group yet", async ({
  page,
  browser,
}) => {
  /*
   * Ada has no open group, so the stage goes to `~`, which the content
   * service reads as her open group and creates for it. It is on the server at
   * once, and so a reload shows it. (It used to be held in this tab until her
   * next write created a group, and a reload lost it.)
   */
  const linus = await contextAs(browser, "linus");
  try {
    const theirs = await linus.newPage();
    await openHttpStudio(theirs);
    await writePatch(theirs, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Linus, held by Ada" },
    ]);
  } finally {
    await linus.close();
  }
  await openHttpStudio(page);
  await markLive(page);
  await openReview(page, studioOf(page));
  await actOnFirstRow(
    studioOf(page),
    "Stage",
    "Linus's change was not offered for staging",
  );
  await expectSameAsReload(
    browser,
    page,
    "ada",
    "Ada staged before she had a group",
  );
});
