import { expect, type Page, test } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie, writePatch } from "./httpMode";

/**
 * Publishing from a page that cannot build, while that page is PAUSED.
 *
 * A page that is not cross-origin isolated cannot build -- every iPhone's
 * Studio, and every overlay -- so Publish opens a builder tab. On an iPhone
 * that tab takes the screen and iOS pauses the page behind it, at once. The
 * page used to make the press and hand the tab its job, so nothing it did
 * after the tap ever ran: the tab sat at "Starting the publish" for as long as
 * anyone watched it. Now the tab presses itself, from what its URL says.
 *
 * The Studio here sends no isolation headers, so it hands off exactly as an
 * iPhone's does, and Chromium can freeze a page the way iOS does
 * (`Page.setWebLifecycleState`): its timers, fetches and channel messages wait
 * until it is thawed.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
  await mock.enablePublishJobs();
});

test.afterAll(async () => {
  await mock.enablePublishJobs(false);
});

function studio(page: Page) {
  return page.locator("#val-shadow-root");
}

function publishButton(page: Page) {
  return studio(page).locator('[data-val-tour="publish"]').getByRole("button");
}

const requestStatuses = async () =>
  (await mock.state()).publishRequests.map((request) => request.status.kind);

test("the builder tab publishes on its own while the page that opened it is paused", async ({
  page,
  context,
}) => {
  await openHttpStudio(page);
  await writePatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: "Published from a phone" },
  ]);
  await expect(publishButton(page)).toBeEnabled({ timeout: 30_000 });
  expect(
    await page.evaluate(() => globalThis.crossOriginIsolated === true),
    "a Studio that can build publishes in place, and this test is about one that cannot",
  ).toBe(false);

  const cdp = await context.newCDPSession(page);
  const opened = page.waitForEvent("popup");
  await publishButton(page).click();
  // What iOS does to the page the moment the builder takes the screen.
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  const builder = await opened;

  try {
    await expect
      .poll(requestStatuses, {
        timeout: 60_000,
        message: "the builder tab never published: it waited for the page",
      })
      .toEqual(["live"]);
    const state = await mock.state();
    expect(state.publishJobs.map((job) => job.done)).toEqual(["sealed"]);
    expect(state.commits).toHaveLength(1);
    // The press was the page's: its id was minted there, in the tap.
    const [request] = state.publishRequests;
    expect(new URL(builder.url()).searchParams.get("publish-request")).toBe(
      request?.requestId,
    );
  } finally {
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
  }

  /*
   * Back in front, the page does not press again: the tab's press was its
   * own. A page that pressed on thawing made a second request for changes
   * already live.
   */
  await page.evaluate(
    () => new Promise((resolve) => setTimeout(resolve, 3_000)),
  );
  expect(await requestStatuses()).toEqual(["live"]);
  expect((await mock.state()).commits).toHaveLength(1);
});
