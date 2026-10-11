import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import {
  createUnsavedPatch,
  mock,
  openHttpStudio,
  sessionCookie,
  writePatch,
} from "./httpMode";

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
 * until it is thawed. That test is Chromium's alone; the rest also run in
 * WebKit (`--project=webkit-http`), Safari's engine and every iPhone's.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

/*
 * Longer than the project's default: each test loads a second Studio, the
 * builder tab, and on a cold dev server that alone is most of a minute.
 */
test.describe.configure({ mode: "serial", timeout: 4 * 60_000 });

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
  browserName,
}) => {
  test.skip(browserName !== "chromium", "freezing a page is a CDP command");
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
    // The press was the page's: its id was minted there, in the tap, and
    // stored for the tab -- not put in the tab's URL.
    const [request] = state.publishRequests;
    const stored = await builder.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("val-publish-handoff-intent:"))
        .map((key) => localStorage.getItem(key))
        .join("\n"),
    );
    expect(stored).toContain(request?.requestId ?? "no request");
    expect(builder.url()).not.toContain(request?.requestId ?? "no request");
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

/*
 * One change, then Publish -- the case that got stuck. A change made just
 * before the tap is still being saved when the tab presses, and the tab
 * presses what the server has: it has to wait for the change rather than
 * publish without it, or find nothing to publish.
 */
test("a change still being saved at the tap is published with it", async ({
  page,
}) => {
  await openHttpStudio(page);
  // Longer than the builder tab takes to load and press.
  let held = 0;
  await page.route("**/api/val/patches**", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    held++;
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    /*
     * Sent from here rather than `route.continue()`d: a request continued
     * after being held this long did not always reach the server, and the
     * test then measured the hold rather than the tab.
     */
    await route.fulfill({ response: await route.fetch() });
  });
  // Made, not saved: what a field's blur does as Publish is tapped.
  await createUnsavedPatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: "Saved after the tap" },
  ]);
  await expect(publishButton(page)).toBeEnabled({ timeout: 30_000 });
  // On its way, and held there: the save is IN FLIGHT at the tap.
  await expect.poll(() => held, { timeout: 30_000 }).toBeGreaterThan(0);

  /*
   * Not frozen, unlike the test above. The page does not press either way,
   * so freezing adds nothing to what this is about -- and Chromium cannot
   * finish sending a request whose page is frozen, so the held save would
   * never land at all.
   */
  const opened = page.waitForEvent("popup");
  await publishButton(page).click();
  const builder = await opened;
  try {
    await expect
      .poll(requestStatuses, {
        timeout: 90_000,
        message: "the builder tab never published the change",
      })
      .toEqual(["live"]);
    expect(await mock.committedSource("/content/authors.val.ts")).toContain(
      "Saved after the tap",
    );
  } finally {
    await builder.close().catch(() => {});
  }
});

/*
 * The same tap with nothing paused, in every engine: one change, then
 * Publish, and the page left to run as a desktop browser leaves it.
 */
test("one change, then Publish, goes live", async ({ page }) => {
  await openHttpStudio(page);
  await writePatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: "One change" },
  ]);
  await expect(publishButton(page)).toBeEnabled({ timeout: 30_000 });
  const opened = page.waitForEvent("popup");
  await publishButton(page).click();
  const builder = await opened;
  try {
    await expect
      .poll(requestStatuses, {
        timeout: 90_000,
        message: "the builder tab never published",
      })
      .toEqual(["live"]);
    expect(await mock.committedSource("/content/authors.val.ts")).toContain(
      "One change",
    );
  } finally {
    await builder.close().catch(() => {});
  }
});

/*
 * A builder tab opened again after its publish -- reloaded, gone back to, the
 * URL reopened -- shows that publish. It must not make it again: the page
 * may hold new changes by now, and a second press would publish those
 * without anyone having pressed Publish for them.
 */
test("the builder tab opened again shows its publish, and publishes nothing new", async ({
  page,
  context,
}) => {
  await openHttpStudio(page);
  await writePatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: "Published once" },
  ]);
  await expect(publishButton(page)).toBeEnabled({ timeout: 30_000 });
  const opened = page.waitForEvent("popup");
  await publishButton(page).click();
  const builder = await opened;
  const builderUrl = builder.url();
  await expect.poll(requestStatuses, { timeout: 90_000 }).toEqual(["live"]);
  await builder.close().catch(() => {});

  // Edited since, and not published: the tab must leave this alone.
  await writePatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: "Not pressed for" },
  ]);

  const again = await context.newPage();
  // Content would answer a second press as the first one, so what is asserted
  // is that there is no second press at all: the tab only looks.
  const pressedAgain: string[] = [];
  again.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/publish-requests")
    ) {
      pressedAgain.push(request.url());
    }
  });
  await again.goto(builderUrl);
  await expect(again.getByRole("heading", { name: "Live" })).toBeVisible({
    timeout: 90_000,
  });
  // Long enough for a second press to have been made, if one were.
  await again.waitForTimeout(5_000);
  expect(pressedAgain).toEqual([]);
  const state = await mock.state();
  expect(state.publishRequests.map((r) => r.status.kind)).toEqual(["live"]);
  expect(state.publishJobs).toHaveLength(1);
  expect(state.commits).toHaveLength(1);
  expect(await mock.committedSource("/content/authors.val.ts")).not.toContain(
    "Not pressed for",
  );
  await again.close();
});

/*
 * A link is not a press. What the builder tab does is stored by the tap that
 * opened it, in this browser, and the URL names only where: a link from
 * anywhere else -- however it is dressed up -- must not publish an editor's
 * pending work, or everyone else's with it.
 */
test("a builder link this browser did not open publishes nothing", async ({
  page,
  context,
}) => {
  await openHttpStudio(page);
  await writePatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: "Not pressed for" },
  ]);

  const crafted = await context.newPage();
  const presses: string[] = [];
  crafted.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/publish-requests")
    ) {
      presses.push(request.url());
    }
  });
  const params = new URLSearchParams({
    "publish-handoff": randomUUID(),
    "publish-do": "press",
    "publish-request": randomUUID(),
    "publish-as": randomUUID(),
  });
  await crafted.goto(`/val?${params.toString()}`);
  await expect(
    crafted.getByText("This tab has no publish to run", { exact: false }),
  ).toBeVisible({ timeout: 90_000 });
  expect(presses).toEqual([]);
  const state = await mock.state();
  expect(state.publishRequests).toEqual([]);
  expect(state.commits).toEqual([]);
  await crafted.close();
});
