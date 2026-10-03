import { expect, test } from "@playwright/test";
import {
  contextAs,
  mock,
  openHttpStudio,
  publishAll,
  sessionCookie,
  writePatch,
} from "./httpMode";
import { expectSameAsReload, markLive } from "./reloadEquivalence";

/**
 * An open Studio shows what a reload would — after each thing that can happen
 * to it from somewhere else.
 *
 * See `reloadEquivalence.ts` for the rule and how it is checked. Each test
 * here is one way the server's state can move while a Studio is open: another
 * browser of the same user, another user, a publish. The assertion is the
 * same every time, which is the point — a divergence anywhere is the same bug.
 *
 * Known to diverge today, and so not here yet: a stage or an unstage made in
 * another browser of the same user, a stage made elsewhere after this browser
 * unstaged the same change, and a stage made before the user has a group. All
 * four are gap 5 in `docs/independent-publish/DESIGN.md`, and they land here
 * with the fix that closes it.
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
