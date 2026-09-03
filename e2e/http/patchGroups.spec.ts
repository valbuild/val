import { expect, test, type Page } from "@playwright/test";
import {
  contextAs,
  mock,
  openHttpStudio,
  peek,
  publishAll,
  sessionCookie,
  USERS,
  writePatch,
} from "./httpMode";

/**
 * Independent publish, against a content service that actually has groups.
 *
 * Everything about patch groups had been driven in `fs` mode and in unit tests
 * — and `fs` mode has no groups, so staging is correctly OFF there and every
 * path through the scoped client was unexercised. Three defects lived in that
 * gap, all of them only reachable once a group exists:
 *
 * - a patch written WHILE scoped was not in the visible set, so the author
 *   stopped seeing their own typing from the first keystroke after staging;
 * - the scope still named the published ids after a publish, so a second one
 *   filtered the chain down to nothing and answered `nothing-to-publish`
 *   forever;
 * - the client never learned the id of the group its own first write created,
 *   so every stage took the "nothing to stage into" branch and did nothing.
 *
 * These run through the real Studio, the real `ValServer`, the real
 * `ValOpsHttp` and a content service that resolves groups the way `home` does.
 * The assertions are on what the CONTENT SERVICE holds, not on what the screen
 * says: a stage that moves the local scope and never reaches the server looks
 * identical in the browser and is lost on reload.
 */

const AUTHORS = "/content/authors.val.ts";
const TEDDY = '/content/authors.val.ts?p="teddy"."name"';
const FREEKH = '/content/authors.val.ts?p="freekh"."name"';

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
  await mock.enablePatchGroups();
});

/** What the page is scoped to, which is what it will publish. */
function scope(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const bag = window as unknown as {
      __VAL_STORES__: {
        system: { patchGroup(): readonly string[] | null };
      };
    };
    return bag.__VAL_STORES__.system.patchGroup() as string[] | null;
  });
}

/** The group id the page believes its own writes are joining. */
function ownGroupId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const bag = window as unknown as {
      __VAL_STORES__: {
        system: { patchStore: { ownGroupId(): string | undefined } };
      };
    };
    return bag.__VAL_STORES__.system.patchStore.ownGroupId();
  });
}

test.describe("patch groups in http mode", () => {
  test("a write creates the author's group, and the client learns its id", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const patchId = await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Ada was here" },
    ]);

    const state = await mock.state();
    expect(
      state.patchGroups,
      "the write did not create a group on the content service",
    ).toHaveLength(1);
    expect(state.patchGroups[0].authorId).toBe(USERS.ada.profileId);
    expect(state.patchGroups[0].patchIds).toEqual([patchId]);

    /*
     * And the CLIENT knows which group that is.
     *
     * The write names no group — the content service resolves the author's open
     * one and creates it if absent — so the save response is the only place
     * this id can come from. Without it every stage is a silent no-op, which is
     * indistinguishable on screen from a stage that worked.
     */
    await expect
      .poll(() => ownGroupId(page), {
        message: "the client never learned the group its write created",
      })
      .toBe(state.patchGroups[0].patchGroupId);
  });

  /**
   * The defect that made the feature unusable, driven the way a person hits it.
   *
   * Once the client is scoped, a patch it writes has to enter the scope with
   * it. It did not: `applyEntries` held the new patch because it was not in the
   * visible set, so the editor rendered the value from BEFORE the keystroke and
   * kept doing so for the life of the tab.
   */
  test("the author keeps seeing their own typing while scoped", async ({
    page,
  }) => {
    await openHttpStudio(page);
    await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "first" },
    ]);
    await expect
      .poll(() => peek(page, TEDDY))
      .toMatchObject({
        status: "ready",
        data: "first",
      });
    // Scoped now — which is what the shell does as soon as the annotation
    // arrives, so by this point in a real session it has already happened.
    await expect
      .poll(() => scope(page), {
        message: "the shell never scoped the client to its group",
      })
      .not.toBeNull();

    await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "second" },
    ]);

    await expect
      .poll(() => peek(page, TEDDY), {
        message: "the author's own edit was held back from them",
      })
      .toMatchObject({ status: "ready", data: "second" });
  });

  /**
   * Two editors, one chain, one publish.
   *
   * This is the whole feature in one test: Ada publishes hers while Linus's sits
   * pending in the same chain, and his is neither shipped nor lost.
   */
  test("publishing ships only this author's group", async ({
    page,
    browser,
  }) => {
    const linusContext = await contextAs(browser, "linus");
    const linusPage = await linusContext.newPage();
    await openHttpStudio(linusPage);
    const theirs = await writePatch(linusPage, AUTHORS, [
      { op: "replace", path: ["freekh", "name"], value: "Linus, unpublished" },
    ]);

    await openHttpStudio(page);
    const mine = await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Ada, publishing" },
    ]);

    // Two groups, one per author, and neither holds the other's patch.
    await expect
      .poll(async () => (await mock.state()).patchGroups.length)
      .toBe(2);

    // Ada's client is scoped to her own group and nothing else.
    await expect
      .poll(() => scope(page), {
        message: "Ada's client was never scoped to her own group",
      })
      .toEqual([mine]);

    const published = await publishAll(page, "Ada publishes her own");
    expect(published.status, published.message ?? "").toBe("published");

    const state = await mock.state();
    const shipped = state.patches.find((patch) => patch.patchId === mine);
    const held = state.patches.find((patch) => patch.patchId === theirs);
    expect(shipped?.applied?.commitSha).toBe(state.commits[0].commitSha);
    expect(
      held?.applied,
      "Linus's unpublished change was committed by Ada's publish",
    ).toBeNull();

    const committed = await mock.committedSource(AUTHORS);
    expect(committed).toContain("Ada, publishing");
    expect(
      committed,
      "the commit carried an author's unpublished work",
    ).not.toContain("Linus, unpublished");

    await linusContext.close();
  });

  /**
   * A second publish from the same tab.
   *
   * The scope named the ids the first publish shipped, and nothing cleared it,
   * so the new chain filtered down to nothing and Save answered
   * `nothing-to-publish` — permanently, for the life of the tab. A publish also
   * CLOSES the group, so this covers the other half: the next write has to land
   * in a new one, which means the client must not be holding the old id.
   */
  test("a second publish works, in a new group", async ({ page }) => {
    await openHttpStudio(page);
    await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "First value" },
    ]);
    expect((await publishAll(page, "First publish")).status).toBe("published");

    const afterFirst = await mock.state();
    expect(afterFirst.patchGroups).toHaveLength(1);
    expect(
      afterFirst.patchGroups[0].publishedAt,
      "the publish did not close the group",
    ).not.toBeNull();

    await writePatch(page, AUTHORS, [
      { op: "replace", path: ["freekh", "name"], value: "Second value" },
    ]);
    const second = await publishAll(page, "Second publish");
    expect(second.status, second.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(2);
    // A new group, because the first was closed by the first publish.
    expect(state.patchGroups).toHaveLength(2);
    const committed = await mock.committedSource(AUTHORS);
    // Both values, so the second commit went on top of the first rather than
    // replacing it.
    expect(committed).toContain("First value");
    expect(committed).toContain("Second value");
    await expect
      .poll(() => peek(page, FREEKH))
      .toMatchObject({
        status: "ready",
        data: "Second value",
      });
  });
});
