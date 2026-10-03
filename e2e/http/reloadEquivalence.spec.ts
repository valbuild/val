import { test, type Page } from "@playwright/test";
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
    await writePatch(theirs, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Linus, published" },
    ]);
    await publishAll(theirs, "Linus ships");
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
  await publishAll(page, "Ada ships");
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
    await publishAll(elsewhere, "Ada ships from the other browser");
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
   * Held on the system until a write creates a group to send it to. A reload
   * before then does not have it.
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
  await openReview(page, studioOf(page));
  await actOnFirstRow(
    studioOf(page),
    "Stage",
    "Linus's change was not offered for staging",
  );
  await markLive(page);
  await expectSameAsReload(
    browser,
    page,
    "ada",
    "Ada staged before she had a group",
  );
});
