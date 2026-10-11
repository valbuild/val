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
import { actOnFirstRow, openReview, rowsIn } from "./staging";

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

/**
 * The staging CONTROLS, which until now existed only in stories.
 *
 * Everything above drives the scope through the system. This drives the button,
 * which is a different claim: that a click reaches the content service at all.
 * The two are easy to confuse and the difference is invisible on screen — a
 * stage that moves the local scope and never persists looks exactly like one
 * that did, right up until the reload that silently brings the change back
 * staged and the next publish ships what the user meant to hold.
 */
test.describe("the staging controls", () => {
  test("unstaging a change persists, survives a reload, and holds the publish", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const patchId = await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Ada, then held back" },
    ]);
    const state = await mock.state();
    const patchGroupId = state.patchGroups[0]?.patchGroupId;
    expect(patchGroupId, "the write created no group").toBeTruthy();
    expect(state.patchGroups[0].patchIds).toEqual([patchId]);

    const studio = page.locator("#val-shadow-root");
    await openReview(page, studio);
    await actOnFirstRow(
      studio,
      "Unstage",
      "the review screen offered no staging control, so groups never reached the UI",
    );

    // The SERVER lost it, which is the half a screenshot cannot show.
    await expect
      .poll(
        async () =>
          (await mock.state()).patchGroups.find(
            (group) => group.patchGroupId === patchGroupId,
          )?.patchIds,
        { message: "the unstage never reached the content service" },
      )
      .toEqual([]);

    // And the editor stops showing it: held is not published, but it is not
    // yours to see in your own scoped view either.
    await expect
      .poll(() => peek(page, TEDDY))
      .toMatchObject({ status: "ready", data: "Theodor René Carlsen" });

    // A group holding nothing publishes nothing, rather than falling back to
    // the whole chain — which is what folding "no scope" and "empty scope"
    // together would do, and it would ship the thing just held back.
    expect((await publishAll(page, "should not ship")).status).toBe(
      "nothing-to-publish",
    );
    expect((await mock.state()).commits).toHaveLength(0);

    /*
     * The reload is the point of the whole test.
     *
     * Local scope is rebuilt from scratch here, so if the click had only moved
     * this tab's state the change would come back STAGED and the next publish
     * would ship what the user meant to hold — silently, and in a commit.
     */
    await openHttpStudio(page);
    await expect
      .poll(() => scope(page), {
        message: "the client never re-scoped after the reload",
      })
      .toEqual([]);
    await expect
      .poll(() => peek(page, TEDDY))
      .toMatchObject({ status: "ready", data: "Theodor René Carlsen" });

    // Staging it again brings it back, and then it ships.
    await openReview(page, studio);
    await actOnFirstRow(
      studio,
      "Stage",
      "the change could not be staged again",
    );
    await expect
      .poll(
        async () =>
          (await mock.state()).patchGroups.find(
            (group) => group.patchGroupId === patchGroupId,
          )?.patchIds,
        { message: "the re-stage never reached the content service" },
      )
      .toEqual([patchId]);

    /*
     * And the content service was told WHICH id the user clicked.
     *
     * `home` stores every membership row as `explicit` or `dependency` and
     * reads what the request does not put in `patchIds` as a dependency — so a
     * client that folds `withPatchIds` in with it files the patch someone chose
     * as one the closure dragged in. That row is the only record anywhere of the
     * difference between what an author decided and what followed from it, and
     * nothing in the response or the screen shows it is wrong.
     *
     * Checked BEFORE the publish, which empties the group.
     */
    const staged = (await mock.state()).patchGroups.find(
      (group) => group.patchGroupId === patchGroupId,
    );
    expect(staged?.askedForPatchIds).toEqual([patchId]);

    const published = await publishAll(page, "Ada ships it after all");
    expect(published.status, published.message ?? "").toBe("published");
    expect(await mock.committedSource(AUTHORS)).toContain(
      "Ada, then held back",
    );

    /*
     * The publish CLOSED the group, which only happens because the client named
     * it on the commit.
     *
     * `home` calls `markPublished` only when `POST /commit` carries
     * `patchGroupId`, and this client never sent it — so in production the
     * group was emptied and left open forever while the mock closed it on a
     * rule of its own. The mock now matches `home`, so this assertion is about
     * the client sending the field rather than about the mock being generous.
     */
    const after = (await mock.state()).patchGroups.find(
      (group) => group.patchGroupId === patchGroupId,
    );
    expect(after?.publishedAt, "the publish did not close the group").not.toBe(
      null,
    );
  });

  /**
   * The window after a publish, when this author has no open group.
   *
   * A publish CLOSES the group, and the next one is created by the next write —
   * so between the two there is nothing to stage into, and the client remembers
   * no id. Two things went wrong there, and this drives both:
   *
   * - a stage made in the window reached the local scope and nothing else. On
   *   screen that is indistinguishable from one that persisted, and it is gone
   *   on reload. That is what the final assertion here is;
   * - staging turned OFF entirely. "Do I have a group" was being asked in place
   *   of "does this deployment have groups", so on a branch whose ONLY group
   *   had just been closed both answers went no at once — the controls vanished
   *   and `usePatchGroupWrites` dropped the write resolver, so the next patch
   *   joined no group and could never be published as part of one. Bob's
   *   pending group keeps the annotation non-empty here, so that half is out of
   *   this test's reach; `patchGroupIdentity.test.ts` pins it at the store.
   */
  test("staging survives the window after a publish", async ({
    page,
    browser,
  }) => {
    // Bob's change, which stays pending throughout: it is what Alice has left
    // to stage once her own work has shipped.
    const bobContext = await contextAs(browser, "linus");
    const bobPage = await bobContext.newPage();
    await openHttpStudio(bobPage);
    const bobPatch = await writePatch(bobPage, AUTHORS, [
      { op: "replace", path: ["freekh", "name"], value: "Bob is waiting" },
    ]);

    await openHttpStudio(page);
    await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Alice ships first" },
    ]);
    expect((await publishAll(page, "Alice ships")).status).toBe("published");
    await expect
      .poll(() => ownGroupId(page), {
        message: "the client kept an id for a group the publish closed",
      })
      .toBe(undefined);

    const studio = page.locator("#val-shadow-root");
    await openReview(page, studio);
    await actOnFirstRow(
      studio,
      "Stage",
      "the staging controls disappeared after the publish",
    );

    /*
     * Bob's group is untouched, and the stage is on the server AT ONCE: sent
     * to `~`, which the content service reads as Alice's open group and creates
     * for it. It used to be held in this tab until her next write created the
     * group — and a reload or her other browser never saw it.
     */
    await expect
      .poll(
        async () => {
          const state = await mock.state();
          return state.patchGroups
            .filter(
              (group) =>
                group.authorId === USERS.ada.profileId &&
                group.publishedAt === null,
            )
            .map((group) => group.patchIds);
        },
        { message: "the stage did not reach the content service at once" },
      )
      .toEqual([[bobPatch]]);
    const during = await mock.state();
    expect(
      during.patchGroups.find(
        (group) =>
          group.authorId === USERS.linus.profileId &&
          group.patchIds.includes(bobPatch),
      ),
      "Bob's own group lost his change",
    ).toBeDefined();

    /*
     * Alice types again. Her write joins the group the stage created.
     */
    const alicePatch = await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Alice, again" },
    ]);

    await expect
      .poll(
        async () => {
          const state = await mock.state();
          const mine = state.patchGroups.find(
            (group) =>
              group.authorId === USERS.ada.profileId &&
              group.publishedAt === null,
          );
          return mine?.patchIds ? [...mine.patchIds].sort() : undefined;
        },
        {
          message:
            "the post-publish write did not join the group the stage created",
        },
      )
      .toEqual([alicePatch, bobPatch].sort());
  });

  /**
   * An unstage clicked while a save is on the wire.
   *
   * A save moves membership too — the server puts the write in its author's
   * group — and the server applies a save and an unstage in the order they
   * ARRIVE. The second write here sits on the first (same field, same patch
   * set), and the user unstages the first while the second's `PUT /patches`
   * is held. Sent at once, the unstage landed first and the save then put the
   * second write back on its own: a group holding an edit without the one it
   * was written on, which a reload shows and the click never meant. Now the
   * unstage waits for the save's answer, and the server ends with nothing.
   *
   * Deterministic because the save is held by the test, not raced: the
   * unstage cannot be sent before it is released, and the order is read off
   * the requests themselves.
   */
  test("an unstage clicked while a save is in flight is sent after it", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const first = await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Ada, first" },
    ]);
    const patchGroupId = (await mock.state()).patchGroups[0]?.patchGroupId;
    expect(patchGroupId, "the write created no group").toBeTruthy();

    const studio = page.locator("#val-shadow-root");
    await openReview(page, studio);
    await expect(rowsIn(studio, "Staged").first()).toBeVisible({
      timeout: 30_000,
    });

    const order: string[] = [];
    let release: (() => void) | null = null;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isSave = (url: URL) => url.pathname.endsWith("/api/val/patches");
    await page.route(isSave, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      order.push("save sent");
      await released;
      const response = await route.fetch();
      order.push("save answered");
      await route.fulfill({ response });
    });
    page.on("request", (request) => {
      if (
        request.method() === "DELETE" &&
        new URL(request.url()).pathname.endsWith("/patch-groups/~/patches")
      ) {
        order.push("unstage sent");
      }
    });

    // The second write. Not flushed here: its save is the one being held.
    const second = await page.evaluate(
      async ({ mfp, ops }) => {
        const bag = window as unknown as {
          __VAL_STORES__: {
            system: {
              patchStore: {
                createPatch(
                  moduleFilePath: string,
                  patch: unknown[],
                ): Promise<{ status: string; record?: { patchId: string } }>;
              };
            };
          };
        };
        const res = await bag.__VAL_STORES__.system.patchStore.createPatch(
          mfp,
          ops,
        );
        if (res.record === undefined) {
          throw new Error(`createPatch failed: ${JSON.stringify(res)}`);
        }
        return res.record.patchId;
      },
      {
        mfp: AUTHORS,
        ops: [{ op: "replace", path: ["teddy", "name"], value: "Ada, second" }],
      },
    );
    await expect.poll(() => order).toEqual(["save sent"]);

    await actOnFirstRow(
      studio,
      "Unstage",
      "the review screen offered no staging control while a save was held",
    );
    // The click has landed on screen...
    await expect.poll(() => scope(page)).not.toContain(first);
    // ...and gone nowhere else: it is waiting for the save. Given a moment to
    // be sent, so that a client that does not wait fails here rather than by
    // luck further down.
    await page.waitForTimeout(1_000);
    expect(order).toEqual(["save sent"]);

    if (release === null) throw new Error("the save was never held");
    const letGo: () => void = release;
    letGo();

    await expect
      .poll(
        async () =>
          (await mock.state()).patchGroups.find(
            (group) => group.patchGroupId === patchGroupId,
          )?.patchIds,
        { message: "the save put back what the unstage took out" },
      )
      .toEqual([]);
    expect(order).toEqual(["save sent", "save answered", "unstage sent"]);
    // Both writes are still in the chain — held, not discarded.
    const chain = (await mock.state()).patches.map((patch) => patch.patchId);
    expect(chain).toEqual(expect.arrayContaining([first, second]));

    // And a reload shows what this tab did.
    await page.unroute(isSave);
    await openHttpStudio(page);
    await expect.poll(() => scope(page)).toEqual([]);
    await expect
      .poll(() => peek(page, TEDDY))
      .toMatchObject({ status: "ready", data: "Theodor René Carlsen" });
  });
});

/**
 * The same user, two browsers.
 *
 * The content service puts a write in its author's open group wherever it was
 * typed, and the other Studio hears of it the ordinary way: the socket says the
 * chain moved, `/stat` names an id it does not have, and the fetch brings the
 * record with the group annotation listing it. The scope there had been seeded
 * once and grew only on that tab's own writes, so the patch was held as
 * unstaged — the value did not change until a reload, and a publish from that
 * Studio left it out while closing the group that held it.
 */
test.describe("another browser of the same user", () => {
  test("a change made in one browser appears in the other without a reload, and publishes from it", async ({
    page,
    browser,
  }) => {
    // Ada's first browser writes first, so an open group exists before the
    // second one loads — the shape it had in production.
    await openHttpStudio(page);
    const first = await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "from browser one" },
    ]);

    const other = await contextAs(browser, "ada");
    const second = await other.newPage();
    try {
      await openHttpStudio(second);
      await expect
        .poll(() => scope(second), {
          message: "the second browser never scoped itself to Ada's group",
        })
        .toContain(first);
      await expect
        .poll(() => peek(second, TEDDY))
        .toMatchObject({ status: "ready", data: "from browser one" });
      /*
       * Reopened, because `next dev` can full-reload the first page while it
       * compiles for the second, and a reloaded page has no stores for
       * `writePatch` to reach for a moment. Nothing about the bug depends on
       * the first browser's page being the original one.
       */
      await openHttpStudio(page);

      // Now a change the second browser has never seen.
      const later = await writePatch(page, AUTHORS, [
        { op: "replace", path: ["freekh", "name"], value: "typed elsewhere" },
      ]);
      const state = await mock.state();
      expect(state.patchGroups).toHaveLength(1);
      expect(state.patchGroups[0].patchIds).toEqual([first, later]);

      await expect
        .poll(() => peek(second, FREEKH), {
          message:
            "the change made in the first browser never appeared in the second",
        })
        .toMatchObject({ status: "ready", data: "typed elsewhere" });
      expect(await scope(second)).toContain(later);

      // And what the second browser shows is what it publishes.
      const published = await publishAll(second, "Ada publishes both");
      expect(published, JSON.stringify(published)).toMatchObject({
        status: "published",
      });
      const after = await mock.state();
      for (const patchId of [first, later]) {
        expect(
          after.patches.find((patch) => patch.patchId === patchId)?.applied,
          `${patchId} was left out of the publish`,
        ).not.toBeNull();
      }
      const committed = await mock.committedSource(AUTHORS);
      expect(committed).toContain("typed elsewhere");
    } finally {
      await other.close();
    }
  });
});

/**
 * The two things a route-level walkthrough found that the store tests could not.
 *
 * Both need a real `ValServer` in proxy mode talking to a content service that
 * has groups, which is exactly what this suite is.
 */
test.describe("the server routes", () => {
  test("one editor cannot change another editor's group", async ({
    page,
    browser,
  }) => {
    // Bob writes, so the content service creates HIS open group.
    const bobContext = await contextAs(browser, "linus");
    const bobPage = await bobContext.newPage();
    await openHttpStudio(bobPage);
    const bobPatch = await writePatch(bobPage, AUTHORS, [
      { op: "replace", path: ["freekh", "name"], value: "Bob's work" },
    ]);

    await openHttpStudio(page);
    const alicePatch = await writePatch(page, AUTHORS, [
      { op: "replace", path: ["teddy", "name"], value: "Alice's work" },
    ]);

    const state = await mock.state();
    const bobGroup = state.patchGroups.find(
      (group) => group.authorId === USERS.linus.profileId,
    );
    expect(bobGroup?.patchIds).toEqual([bobPatch]);

    /*
     * Alice, with nothing but her own session, aims at Bob's group id. Group
     * ids are not secret — `GET /patches?include_patch_groups=true` hands every
     * editor the id and author of every group on the branch — so this is a
     * request any logged-in editor can make.
     */
    const unstage = await page.request.fetch(
      "/api/val/patch-groups/~/patches",
      {
        method: "DELETE",
        data: { patchGroupId: bobGroup?.patchGroupId, patchIds: [bobPatch] },
      },
    );
    expect(unstage.status()).toBe(403);

    const stage = await page.request.fetch("/api/val/patch-groups/~/patches", {
      method: "PUT",
      data: {
        patchGroupId: bobGroup?.patchGroupId,
        patchIds: [alicePatch],
      },
    });
    expect(stage.status()).toBe(403);

    /*
     * And the third route that takes a group id: PUBLISHING closes the group it
     * names, and closing somebody else's is worse than either of the above.
     * Bob's pending patches land in a closed group and in no open one, so a
     * scoped draft render of his shows base for them, his own tab still
     * believes the group is open, and his next stage is refused with 409.
     *
     * Stage and unstage were guarded from the start; `/save` was not, and the
     * content API marks the group published on id alone with no author clause —
     * so the id was trusted twice and checked nowhere.
     */
    const publish = await page.request.fetch("/api/val/save", {
      method: "POST",
      data: {
        patchIds: [alicePatch],
        message: "Alice publishes, naming Bob's group",
        patchGroupId: bobGroup?.patchGroupId,
      },
    });
    expect(publish.status()).toBe(403);

    // Refused is not enough — the group has to be untouched. Emptying Bob's
    // group would make his next publish ship nothing; adding to it would make
    // it ship Alice's change under his name; closing it would strand his work
    // where he can neither publish nor see it.
    const after = await mock.state();
    const bobAfter = after.patchGroups.find(
      (group) => group.patchGroupId === bobGroup?.patchGroupId,
    );
    expect(bobAfter?.patchIds).toEqual([bobPatch]);
    expect(bobAfter?.publishedAt, "Bob's group was closed by Alice").toBeNull();

    await bobContext.close();
  });

  test("a published change stays visible to everyone until the deploy lands", async ({
    page,
    browser,
  }) => {
    const bobContext = await contextAs(browser, "linus");
    const bobPage = await bobContext.newPage();
    await openHttpStudio(bobPage);
    await writePatch(bobPage, AUTHORS, [
      { op: "replace", path: ["freekh", "name"], value: "Bob published this" },
    ]);
    expect((await publishAll(bobPage, "Bob ships")).status).toBe("published");

    /*
     * Publishing commits the patch but does not move the base — it stays in the
     * chain with `appliedAt` set until the next deployment. Scoping used to
     * drop it, so in this window Bob's own preview reverted the field he had
     * just shipped and Alice never saw it at all. Anything she wrote on top
     * would be authored against content already stale on `main`.
     */
    for (const [who, viewer] of [
      ["Bob", bobPage],
      ["Alice", page],
    ] as const) {
      if (viewer === page) await openHttpStudio(page);
      const draft = await viewer.request.fetch(
        "/api/val/sources/~?own_patch_groups_only=true",
        { method: "PUT", data: {} },
      );
      expect(draft.status()).toBe(200);
      const json = await draft.json();
      expect(
        json.modules[AUTHORS]?.source?.freekh?.name,
        `${who}'s scoped draft lost the published change`,
      ).toBe("Bob published this");
    }

    await bobContext.close();
  });
});
