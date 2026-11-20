import { expect } from "@playwright/test";
import { test } from "../studio";
import { watchForProblems } from "../pageProblems";

/**
 * Analytics mode on the TanStack showcase (`VAL_ANALYTICS=true` in
 * `examples/tanstack/.env.development`, passed to `<ValProvider analytics>` by
 * `_site.tsx`'s loader), as a VISITOR sees it: no Val enable cookie, no draft
 * mode.
 *
 * The rule under test is `useEncodesEditTags`: no edit tags on the server or
 * while a component hydrates, tags from the render after. What only a real
 * browser and the real bundle can show is the half the unit tests cannot --
 * that `autoTagJSX`, in the app's own JSX runtime, then turns each tag into a
 * `data-val-path` attribute and cleans the text, and that a lazily loaded
 * component handed a string as a prop hydrates without a mismatch.
 */

/** A run of the zero-width characters an edit tag is written in. */
const EDIT_TAG = /(?:\u200B|\u200C|\u200D|\uFEFF){20,}/;

const TAGLINE = "Content as code, in a TanStack Start app.";

test.describe("analytics mode, for a visitor", () => {
  test("the HTML a visitor is sent carries no edit tags", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain(TAGLINE);
    // `ValImage` always writes the attribute, empty when its source carries no
    // tag, so the check is that none of them names anything.
    expect(html).not.toMatch(/data-val-path="[^"]/);
    expect(html).not.toMatch(EDIT_TAG);
  });

  test("content is tagged after hydration, with clean text and no mismatch", async ({
    page,
  }) => {
    const problems = watchForProblems(page);
    await page.goto("/");

    // The tagline is read with `useVal` in the route and rendered by a lazy
    // component it is passed to as a prop.
    const tagline = page.locator("[data-val-path]", { hasText: TAGLINE });
    await expect(tagline.first()).toBeVisible();
    await expect(tagline.first()).toHaveText(TAGLINE);
    await expect(tagline.first()).toHaveAttribute(
      "data-val-path",
      /^\/src\/content\/site\.val\.ts\?p=/,
    );

    // Nothing the page shows still carries a tag in its text.
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).not.toMatch(EDIT_TAG);

    await page.waitForTimeout(1_000);
    expect(problems.thrown, "uncaught in the page").toEqual([]);
    expect(
      problems.logged.filter((line) => /hydrat/i.test(line)),
      "hydration errors",
    ).toEqual([]);
  });

  test("the page sends what it rendered and what was viewed", async ({
    page,
  }) => {
    // Playwright's browser says it is automated, and the script counts no
    // automated browser. This one is standing in for a person.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const problems = watchForProblems(page);
    const firstBeacon = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/val/analytics") &&
        request.method() === "POST",
    );
    await page.goto("/");
    const request = await firstBeacon;
    const response = await request.response();
    expect(response?.status()).toBe(200);
    expect(await response?.json()).toEqual({ counted: false });

    const beacon = request.postDataJSON();
    expect(beacon.v).toBe(1);
    expect(beacon.route).toBe("/");
    // The content version, from VAL_CONTENT_VERSION in the showcase's
    // .env.development, through the layout's loader and the provider.
    expect(beacon.cv).toBe("showcase-dev");
    expect(beacon.view.device).toBe("desktop");
    const site = "/src/content/site.val.ts";
    // The tagline is at the top of the page: on screen from the start, so
    // viewed well before the first beacon goes, about 3 s in.
    const tagline = await page
      .locator("[data-val-path]", { hasText: TAGLINE })
      .first()
      .getAttribute("data-val-path");
    const taglinePath = tagline?.slice(`${site}?p=`.length);
    expect(beacon.rendered[site]).toContain(taglinePath);
    expect(beacon.viewed[site]).toContain(taglinePath);

    expect(problems.thrown, "uncaught in the page").toEqual([]);
    expect(problems.logged, "console errors").toEqual([]);
  });

  test("on a long page, what was scrolled to is viewed and what was not is rendered only", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const beacons: {
      route: string;
      rendered: Record<string, string[]>;
      viewed: Record<string, string[]>;
    }[] = [];
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/val/analytics") &&
        request.method() === "POST"
      ) {
        beacons.push(request.postDataJSON());
      }
    });
    await page.goto("/showcase");
    await expect.poll(() => beacons.length).toBeGreaterThan(0);

    // Content well below the fold: two screens down at least. One path, so
    // the beacon's entry for it is exactly this element's.
    const below = await page.evaluate(() => {
      const fold = window.innerHeight * 2;
      const found = [...document.querySelectorAll("[data-val-path]")]
        .filter((element) => {
          const path = element.getAttribute("data-val-path") ?? "";
          return (
            path.includes("?p=") &&
            !path.includes(",") &&
            element.getBoundingClientRect().top > fold
          );
        })
        .pop();
      if (found === undefined) return null;
      found.setAttribute("data-e2e-below", "");
      return found.getAttribute("data-val-path");
    });
    expect(below, "content two screens below the fold").not.toBeNull();
    const [module, path] = (below ?? "").split("?p=");
    const first = beacons[0];
    expect(first.route).toBe("/showcase");
    expect(first.rendered[module]).toContain(path);
    expect(first.viewed[module] ?? []).not.toContain(path);

    // Scrolled to, and left on screen for longer than it takes to count.
    await page.locator("[data-e2e-below]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_500);
    // A navigation ends the page view, and sends what it was still holding.
    await page.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect
      .poll(() =>
        beacons.some(
          (beacon) =>
            beacon.route === "/showcase" &&
            (beacon.viewed[module] ?? []).includes(path),
        ),
      )
      .toBe(true);
  });

  test("a client-side navigation is a page view of its own", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const beacons: { route: string; view?: unknown }[] = [];
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/val/analytics") &&
        request.method() === "POST"
      ) {
        beacons.push(request.postDataJSON());
      }
    });
    await page.goto("/");
    // Tagged content means the page has hydrated, so the click below is the
    // router's: `pushState`, not a page load. Clicking at once also means the
    // script may not have started yet -- then the landing page view is the
    // one it sends for the page the visitor already left.
    await expect(
      page.locator("[data-val-path]", { hasText: TAGLINE }).first(),
    ).toBeVisible();
    await page.getByRole("link", { name: "A post" }).click();
    await expect(page).toHaveURL(/\/posts\/hello-world$/);
    await expect
      .poll(() =>
        // The route's pattern, never the pathname: a pathname can hold
        // something about one visitor.
        beacons.find((b) => b.route === "/posts/$postId" && b.view),
      )
      .toBeTruthy();
    // The first page view went when the second began, not later.
    expect(beacons.find((b) => b.route === "/" && b.view)).toBeTruthy();
  });
});
