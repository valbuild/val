import { expect, test } from "@playwright/test";
import {
  chainLength,
  contextAs,
  mock,
  openHttpStudio,
  publishAll,
  USERS,
  writePatch,
} from "./httpMode";

/**
 * Two editors, at once.
 *
 * `fs` mode has one writer by construction — a directory on a laptop — so
 * everything about more than one person editing is `http`-mode-only: patches
 * carry an author, the chain is single-writer and linear so a second editor's
 * write has to name the first one's patch as its parent, and each Studio learns
 * about the other's changes over its own WebSocket.
 *
 * Each user gets their own browser context because the session is a cookie: the
 * same context is the same person, and two people is two contexts.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("two editors at once", () => {
  /**
   * The chain stays linear across two editors, and each change keeps its author.
   *
   * Deliberately asserted on the end state rather than on the mechanism. Whether
   * the second editor's write appends cleanly or is refused with a 409 and
   * retried depends on whether their socket delivered the first patch first, and
   * that is a race — but the result must not be: both patches present, one chain,
   * each credited to the person who made it.
   */
  test("two editors produce one linear chain, each change attributed", async ({
    browser,
  }) => {
    const adaContext = await contextAs(browser, "ada");
    const linusContext = await contextAs(browser, "linus");
    const ada = await adaContext.newPage();
    const linus = await linusContext.newPage();
    try {
      await openHttpStudio(ada);
      await openHttpStudio(linus);

      const adaPatch = await writePatch(ada, "/content/authors.val.ts", [
        { op: "replace", path: ["teddy", "name"], value: "Ada's edit" },
      ]);
      const linusPatch = await writePatch(linus, "/content/authors.val.ts", [
        { op: "replace", path: ["freekh", "name"], value: "Linus's edit" },
      ]);

      const state = await mock.state();
      const byId = new Map(
        state.patches.map((patch) => [patch.patchId, patch]),
      );
      expect(byId.get(adaPatch)?.authorId).toBe(USERS.ada.profileId);
      expect(byId.get(linusPatch)?.authorId).toBe(USERS.linus.profileId);

      // One chain: exactly one patch has no parent, and every other patch's
      // parent is a patch that exists.
      const roots = state.patches.filter(
        (patch) => patch.parentPatchId === null,
      );
      expect(roots, "the chain is not rooted at a single patch").toHaveLength(
        1,
      );
      for (const patch of state.patches) {
        if (patch.parentPatchId !== null) {
          expect(
            byId.has(patch.parentPatchId),
            `patch ${patch.patchId} names a parent that does not exist`,
          ).toBe(true);
        }
      }
    } finally {
      await adaContext.close();
      await linusContext.close();
    }
  });

  /**
   * One editor's change reaches the other's Studio.
   *
   * Over the WebSocket, and only over it: `/stat`'s long-poll interval in proxy
   * mode is twenty minutes, so nothing else could deliver this inside a test. If
   * the socket stops working, this is the test that says so.
   */
  test("a change made by one editor arrives in the other's Studio", async ({
    browser,
  }) => {
    const adaContext = await contextAs(browser, "ada");
    const linusContext = await contextAs(browser, "linus");
    const ada = await adaContext.newPage();
    const linus = await linusContext.newPage();
    try {
      await openHttpStudio(ada);
      await openHttpStudio(linus);
      expect(await chainLength(linus)).toBe(0);

      await writePatch(ada, "/content/authors.val.ts", [
        { op: "replace", path: ["teddy", "name"], value: "Ada typed this" },
      ]);

      await expect
        .poll(() => chainLength(linus), {
          message: "the other editor's Studio never learned about the change",
        })
        .toBe(1);
    } finally {
      await adaContext.close();
      await linusContext.close();
    }
  });

  /**
   * Publishing takes everyone's changes, credited to whoever pressed the button.
   *
   * That is the real contract and the surprising half of it: the commit has one
   * committer, but the patches in it can have several authors. A publish that
   * silently dropped the other editor's patch would look like a successful
   * publish to both of them.
   */
  test("publishing commits both editors' changes, credited to the publisher", async ({
    browser,
  }) => {
    const adaContext = await contextAs(browser, "ada");
    const linusContext = await contextAs(browser, "linus");
    const ada = await adaContext.newPage();
    const linus = await linusContext.newPage();
    try {
      await openHttpStudio(ada);
      await openHttpStudio(linus);

      await writePatch(ada, "/content/authors.val.ts", [
        { op: "replace", path: ["teddy", "name"], value: "From Ada" },
      ]);
      await writePatch(linus, "/content/authors.val.ts", [
        { op: "replace", path: ["freekh", "name"], value: "From Linus" },
      ]);

      // Linus publishes. Wait until his Studio holds both patches, or he would
      // publish only his own and the test would prove nothing.
      await expect.poll(() => chainLength(linus)).toBe(2);
      const published = await publishAll(linus, "Published by Linus");
      expect(published.status, published.message ?? "").toBe("published");

      const state = await mock.state();
      expect(state.commits).toHaveLength(1);
      expect(state.commits[0].creator).toBe(USERS.linus.profileId);
      for (const patch of state.patches) {
        expect(
          patch.applied?.commitSha,
          `patch ${patch.patchId} by ${patch.authorId} was not in the commit`,
        ).toBe(state.commits[0].commitSha);
      }
      const committed = await mock.committedSource("/content/authors.val.ts");
      expect(committed).toContain("From Ada");
      expect(committed).toContain("From Linus");
    } finally {
      await adaContext.close();
      await linusContext.close();
    }
  });

  /**
   * A change one editor discards disappears from the other's Studio too.
   *
   * The inverse of the arrival test, and the one that catches a store which adds
   * foreign patches but never removes them — the state that makes the publish
   * button think there is something to publish forever.
   */
  test("a change one editor discards leaves the other's Studio", async ({
    browser,
  }) => {
    const adaContext = await contextAs(browser, "ada");
    const linusContext = await contextAs(browser, "linus");
    const ada = await adaContext.newPage();
    const linus = await linusContext.newPage();
    try {
      await openHttpStudio(ada);
      await openHttpStudio(linus);

      await writePatch(ada, "/content/authors.val.ts", [
        { op: "replace", path: ["teddy", "name"], value: "Briefly" },
      ]);
      await expect.poll(() => chainLength(linus)).toBe(1);

      await ada.evaluate(async () => {
        const bag = window as unknown as {
          __VAL_STORES__: {
            system: {
              patchStore: { allRecords(): { patchId: string }[] };
              discard(
                ids: string[],
              ): Promise<{ status: string; message?: string }>;
            };
          };
        };
        const system = bag.__VAL_STORES__.system;
        const ids = system.patchStore
          .allRecords()
          .map((record) => record.patchId);
        const res = await system.discard(ids);
        if (res.status !== "discarded") {
          throw new Error(`could not discard: ${res.message ?? res.status}`);
        }
      });

      await expect
        .poll(async () => (await mock.state()).patches.length)
        .toBe(0);
      await expect
        .poll(() => chainLength(linus), {
          message:
            "the other editor's Studio still holds a patch that was discarded",
        })
        .toBe(0);
    } finally {
      await adaContext.close();
      await linusContext.close();
    }
  });
});
