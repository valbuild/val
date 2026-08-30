import { expect, test } from "@playwright/test";
import {
  currentParentRef,
  discardAll,
  mock,
  openHttpStudio,
  reportedErrors,
  sessionCookie,
  tryWritePatch,
  writePatch,
} from "./httpMode";

/**
 * Editing again after a discard.
 *
 * The reported failure is two lines in the Studio — "An edit could not be saved
 * and has been reverted." with `<module>: Parent patch not found` under it — and
 * it is the worst shape a bug can take here, because the edit is GONE. Every
 * later edit fails the same way until the tab is reloaded.
 *
 * ## Why it happens
 *
 * The chain is linear and every write names its parent. `PatchSync` computes
 * that parent from `/stat`, and in proxy mode `/stat` is only re-read when the
 * WebSocket says the chain moved — the poll behind it waits twenty minutes while
 * a socket is carrying changes (`WebSocketStatInterval` in `useStatus.ts`). A
 * discard deletes patches through `DELETE /patches` and drops them from
 * `PatchStore`, and tells `PatchSync` nothing. So between the discard and the
 * next stat the sync still names a patch the content service no longer has —
 * and `PatchSync.savedNotInStat` keeps a discarded id even once a stat HAS
 * arrived, because ids leave that list only by being listed, and a deleted patch
 * never is.
 *
 * ## Why that costs the edit rather than a round trip
 *
 * `PatchSync` splits a refused write in two, and the split is the whole
 * difference: a 409 is `conflict`, which re-syncs and retries; anything else is
 * `rejected`, which is permanent, so the patch is dropped and the field reverts.
 * The content service answers a parent it does not have with `Parent patch not
 * found` and a status that is not 409, so a stale parent lands on the
 * destroying side of that split. The mock answers the same way — see
 * `savePatch` in `e2e/mock-content-host/server.ts`.
 */

const MODULE = "/content/authors.val.ts";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

// Deliberately NOT `serial`, unlike the rest of this directory: serial skips
// every later test once one fails, and these three are three separate facts
// about the same sequence. A reader needs all three, especially the third —
// whether the Studio recovers is the difference between one lost edit and an
// editor that cannot save until it is reloaded. `mock.reset()` plus a page each
// is all the isolation they need.

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("editing after a discard", () => {
  /**
   * The cause, on its own, so a failure points at the sync rather than the save.
   *
   * Not a restatement of the test below: this one fails the moment the client
   * holds a parent that cannot work, which is true whatever the content service
   * decides to answer. If the service were changed to answer 409 the write would
   * recover and the test below would pass — and this would still be the bug.
   */
  test("the parent named next is one the content service still has", async ({
    page,
  }) => {
    await openHttpStudio(page);
    await writePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "Before the discard" },
    ]);

    await discardAll(page);

    const parent = await currentParentRef(page);
    if (parent?.type !== "patch") {
      // `head` is the correct answer here — the chain is empty — and so is any
      // id the service still holds. Only a dangling id is the bug.
      return;
    }
    const live = (await mock.state()).patches.map((patch) => patch.patchId);
    expect(
      live,
      "the next write would name a patch the discard deleted",
    ).toContain(parent.patchId);
  });

  /**
   * The same sequence, taken all the way to what the editor sees.
   *
   * Three assertions rather than one because they fail for different reasons and
   * a reader needs to know which happened: the edit never reached the service,
   * the Studio threw it away locally, and it said so in the words from the
   * report.
   */
  test("the next edit is saved rather than reverted", async ({ page }) => {
    await openHttpStudio(page);
    await writePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "Before the discard" },
    ]);

    await discardAll(page);

    const written = await tryWritePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "After the discard" },
    ]);

    const errors = await reportedErrors(page);
    const state = await mock.state();
    expect(
      state.patches.map((patch) => patch.patchId),
      `the edit after the discard never reached the content service. The Studio said: ${JSON.stringify(errors)}`,
    ).toContain(written.patchId);
    expect(
      written.keptLocally,
      "the edit was dropped locally: the Studio took the refusal as permanent",
    ).toBe(true);
    expect(
      errors.map((error) => error.message),
      "the Studio reported the edit as reverted",
    ).not.toContain("An edit could not be saved and has been reverted.");
  });

  /**
   * And it does not heal, which is the half of the report that makes it urgent.
   *
   * One lost edit is a bad afternoon; a Studio that cannot save anything until
   * the tab is reloaded is an editor stuck. The second write goes out after the
   * first has already been refused, so every notification the discard produces
   * has had time to arrive — if the parent were merely stale, this one would
   * work.
   */
  test("a later edit is not lost too", async ({ page }) => {
    await openHttpStudio(page);
    await writePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "Before the discard" },
    ]);

    await discardAll(page);
    await tryWritePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "After the discard" },
    ]);

    const second = await tryWritePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "And again" },
    ]);

    const state = await mock.state();
    expect(
      state.patches.map((patch) => patch.patchId),
      "the Studio never recovered: a second edit was lost the same way",
    ).toContain(second.patchId);
  });
});
