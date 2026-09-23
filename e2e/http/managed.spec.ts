import { expect, test } from "@playwright/test";
import {
  mock,
  openHttpStudio,
  publishAll,
  sessionCookie,
  USERS,
  writePatch,
} from "./httpMode";

/**
 * A project with NO GIT REPOSITORY AT ALL, edited and published.
 *
 * The headline of `content-of-record`, and the one thing every other spec in
 * this directory cannot see: they run against an app configured with
 * `VAL_GIT_COMMIT` and `VAL_GIT_BRANCH`, which is a project whose commits are
 * mirrored into a repository. Absent, http mode is selected on credentials
 * alone, the content service mints the commit sha, and there is nothing to
 * mirror into.
 *
 * Run it with:
 *
 *     VAL_E2E_MANAGED=1 pnpm exec playwright test --project=chromium-http \
 *       e2e/http/managed.spec.ts
 *
 * Skipped otherwise rather than given a project of its own, because the thing
 * under test is the SERVER's configuration -- the two env vars in
 * `playwright.config.ts` -- and a second project would mean a second Next
 * build of the same app for two variables.
 */
test.skip(
  !process.env.VAL_E2E_MANAGED,
  "needs the app started without VAL_GIT_COMMIT / VAL_GIT_BRANCH: " +
    "VAL_E2E_MANAGED=1 pnpm exec playwright test --project=chromium-http",
);

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("a project with no repository", () => {
  test("THE STUDIO COMES UP, which is where this used to end", async ({
    page,
  }) => {
    /*
     * A missing commit used to be a boot error -- "VAL_GIT_COMMIT env var must
     * be set in proxy mode" -- so every seeded project answered 500 from the
     * first request and nothing below this line was reachable.
     */
    await openHttpStudio(page);
    await expect(page.getByText("Pick something to edit")).toBeVisible();
  });

  test("...an edit reaches the content service", async ({ page }) => {
    await openHttpStudio(page);
    const patchId = await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "Written with no git" },
    ]);
    const state = await mock.state();
    expect(state.patches.map((patch) => patch.patchId)).toContain(patchId);
  });

  test("...AND IT PUBLISHES, which is the whole point", async ({ page }) => {
    await openHttpStudio(page);
    const patchId = await writePatch(page, "/content/authors.val.ts", [
      {
        op: "replace",
        path: ["teddy", "name"],
        value: "Published with no git",
      },
    ]);

    const published = await publishAll(page, "A publish with no repository");
    expect(published.status, published.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(1);
    expect(state.commits[0].commitMessage).toBe("A publish with no repository");
    expect(state.commits[0].creator).toBe(USERS.ada.profileId);

    // The patch is applied by the commit, exactly as in the mirrored case: the
    // patch chain is content's either way, and that is what does not change.
    const saved = state.patches.find((patch) => patch.patchId === patchId);
    expect(
      saved?.applied?.commitSha,
      "the patch was not marked applied by the commit",
    ).toBe(state.commits[0].commitSha);
  });

  test("...and the commit carries NO `.val.ts`, because there is nowhere to put one", async ({
    page,
  }) => {
    /*
     * The one visible difference, asserted rather than left implicit -- it is
     * the thing a reader of `ValOps.mirrorsSourceFiles` most needs to see is
     * deliberate.
     *
     * `patchedSourceFiles` is the GIT MIRROR: the module's data rendered back
     * out as code, for a repository to hold. What the commit records instead
     * is `modules` -- each changed module's Source and the schema it was
     * written under -- which comes from the stores and is what history reads
     * and what `connect-github` folds into a repository later. So nothing is
     * lost by not producing the mirror; it is produced when there is somewhere
     * for it to go.
     */
    await openHttpStudio(page);
    await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "No mirror for this" },
    ]);
    const published = await publishAll(page, "No mirror");
    expect(published.status, published.message ?? "").toBe("published");

    expect(await mock.committedSource("/content/authors.val.ts")).toBe(null);
  });
});

/**
 * How a publish is NARRATED when nobody outside the browser will finish it.
 *
 * The rest of this directory runs against a connected project: a commit lands,
 * a host picks it up, and `Building` becomes `Live` because something outside
 * moves it. Here there is no repository and no host watching one, so a
 * `Building` state would be a spinner with no event that could ever end it --
 * it would not resolve on a reload, on a retry, or tomorrow, and the reader
 * would have no way to tell it from a deploy that is merely slow.
 *
 * This is the only place that difference can be seen in a browser, because it
 * is the only run where the content service calls the project managed. The unit
 * tests pin the rule; this pins that the rule reaches the screen.
 */
test.describe("a publish nobody else will finish", () => {
  test("says it is saved rather than that it is building", async ({ page }) => {
    await openHttpStudio(page);
    await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "Saved not live" },
    ]);
    const published = await publishAll(page, "Saved, not deployed");
    expect(published.status, published.message ?? "").toBe("published");

    const summary = page
      .locator("#val-shadow-root")
      .getByRole("button", { name: /^Deployments: / });
    await expect
      .poll(
        () =>
          summary
            .getAttribute("aria-label")
            .then((label) => (label ?? "").replace(/^Deployments: /, "")),
        {
          message: "the publish never reached the deploy feed",
        },
      )
      // Not "Building", which is what the same feed says for a connected
      // project from the same rows -- see `deployments.spec.ts`.
      .toBe("Saved, not yet live");
  });
});
