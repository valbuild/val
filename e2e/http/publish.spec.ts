import { expect, test } from "@playwright/test";
import {
  discardAll,
  mock,
  openHttpStudio,
  peek,
  publishAll,
  sessionCookie,
  USERS,
  writePatch,
} from "./httpMode";

/**
 * Publishing, in the mode where publishing means a git commit.
 *
 * In `fs` mode a publish writes files and deletes the patches. In `http` mode it
 * is an HTTP call that produces a commit, the patches come back marked applied
 * rather than deleted, and the Studio then has to stop counting them as unsaved
 * without losing the values they carry. That difference is `ValOpsHttp` plus
 * `PatchStore`'s applied/published handling, and none of it had a test that ran
 * against a server.
 *
 * The deployment half is here for the same reason: a deployment is something CI
 * does, arriving over a WebSocket the browser opened. No editor action produces
 * one, so the mock's control plane produces it instead.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("changes and publishing in http mode", () => {
  test("a change reaches the content service, attributed to its author", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const patchId = await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "Ada was here" },
    ]);

    const state = await mock.state();
    const saved = state.patches.find((patch) => patch.patchId === patchId);
    expect(saved, "the patch never reached the content service").toBeTruthy();
    expect(saved?.path).toBe("/content/authors.val.ts");
    // The author is the session's profile id, not a placeholder. This is what
    // the Studio shows next to a change and what a commit is credited to.
    expect(saved?.authorId).toBe(USERS.ada.profileId);
    // Nothing is applied until a publish.
    expect(saved?.applied).toBeNull();
  });

  /**
   * The whole publish, and the three things it has to leave behind.
   *
   * The commit is the obvious one. The other two are where the bugs live: the
   * committed source has to contain the edited value (so the change actually
   * shipped), and the patch has to be marked applied rather than deleted (so a
   * second publish does not try to re-apply it, and so the Studio stops calling
   * it unsaved).
   */
  test("publishing commits the change and marks the patch applied", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const patchId = await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "Published by Ada" },
    ]);

    const published = await publishAll(page, "A change from the e2e suite");
    expect(published.status, published.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(1);
    expect(state.commits[0].commitMessage).toBe("A change from the e2e suite");
    expect(state.commits[0].creator).toBe(USERS.ada.profileId);
    expect(state.commits[0].parentCommitSha).toBe("mockcommit0");

    const saved = state.patches.find((patch) => patch.patchId === patchId);
    expect(
      saved?.applied?.commitSha,
      "the patch was not marked applied by the commit",
    ).toBe(state.commits[0].commitSha);

    const committed = await mock.committedSource("/content/authors.val.ts");
    expect(
      committed,
      "the commit carried no source for the module",
    ).toBeTruthy();
    expect(committed).toContain("Published by Ada");
  });

  /**
   * A second cycle, on top of the first commit.
   *
   * This is the case a mock that always reads from disk gets wrong: the second
   * publish prepares against the *committed* text, so if the content service
   * forgot the first commit the second one would either fail to apply or silently
   * drop the first change. Asserting both values are in the second commit is
   * what proves the chain held.
   */
  test("a second change publishes on top of the first commit", async ({
    page,
  }) => {
    await openHttpStudio(page);
    await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "First value" },
    ]);
    expect((await publishAll(page, "First publish")).status).toBe("published");

    await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["freekh", "name"], value: "Second value" },
    ]);
    const second = await publishAll(page, "Second publish");
    expect(second.status, second.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(2);
    // Fast-forward: the second commit's parent is the first commit.
    expect(state.commits[1].parentCommitSha).toBe(state.commits[0].commitSha);

    const committed = await mock.committedSource("/content/authors.val.ts");
    expect(
      committed,
      "the second commit lost the first commit's change",
    ).toContain("First value");
    expect(committed).toContain("Second value");
  });

  test("discarding removes the patch from the content service", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const patchId = await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "To be discarded" },
    ]);
    expect((await mock.state()).patches.map((p) => p.patchId)).toContain(
      patchId,
    );

    await discardAll(page);
    await expect
      .poll(async () => (await mock.state()).patches.length, {
        message: "the discarded patch is still on the content service",
      })
      .toBe(0);

    // And the value is back to what the module ships with — a discard has to undo
    // the edit locally, not merely forget the patch.
    await expect
      .poll(() => peek(page, '/content/authors.val.ts?p="teddy"."name"'))
      .not.toBe("To be discarded");
  });

  /**
   * A publish that has nothing to publish is not an error.
   *
   * Worth a line because the publish button's disabled state is derived, and a
   * publish path that threw here would surface as a failure the editor caused by
   * clicking a button they were allowed to click.
   */
  test("publishing with no changes is a no-op", async ({ page }) => {
    await openHttpStudio(page);
    const res = await publishAll(page);
    expect(res.status).toBe("nothing-to-publish");
    expect((await mock.state()).commits).toHaveLength(0);
  });
});
