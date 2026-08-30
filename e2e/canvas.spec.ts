import { expect, test } from "@playwright/test";
import {
  clearPatchChain,
  closeNavPanel,
  expandRow,
  openSiteMap,
  openStudio,
} from "./studio";

/**
 * The canvas: the running site beside the editor for it.
 *
 * What this is really checking is that the canvas shows the *real* page. The
 * shell was built against a hardcoded demo page, and that page renders happily
 * with no app behind it at all — so a canvas that had come loose from the
 * running site would still look right in a screenshot. The assertion that
 * catches it is the frame's URL: it has to be the route the selected page is
 * on, served by the app, and it has to have rendered that route's content.
 *
 * The canvas is offered wherever there is a site to look at, on a route or off
 * one, so both are checked — and so is the address bar, because the canvas being
 * a browser is only true if you can actually point it somewhere.
 */

/** The frame the canvas is showing, if it is showing one. */
function canvasFrameUrls(page: import("@playwright/test").Page): string[] {
  return page
    .frames()
    .map((frame) => frame.url())
    .filter((url) => url !== "" && !url.includes("/val"));
}

/**
 * From a clean chain, because this suite reads the fixture's content.
 *
 * Without it a leftover patch from another suite — `studio-ui` renames an author
 * to prove an edit landed — is still applied, and a test that looks for the
 * fixture's own text fails for a reason that has nothing to do with the canvas.
 */
test.beforeAll(async ({ request }) => {
  await clearPatchChain(request);
});

test.describe("the canvas", () => {
  test("puts the running page beside its editor", async ({ page }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");

    // The editor for the page opened first: the canvas joins it rather than
    // replacing it, so both have to be on screen.
    const title = studio.locator("input").first();
    await expect(title).toHaveValue("Blog 1");

    const canvasButton = studio.getByRole("button", { name: "Canvas" });
    await expect(
      canvasButton,
      "the canvas was not offered on a page Val resolves",
    ).toBeVisible();
    await canvasButton.click();

    // The zoom control only exists once the canvas is laid out, and the
    // percentage only stops being 100% once it has measured the page against
    // the pane — which is the difference between a canvas that opened and one
    // whose column never moved.
    await expect(
      studio.getByRole("button", { name: "Fit page to screen" }),
    ).toBeVisible();

    /**
     * The frame, which is the point.
     *
     * `expect.poll` because the frame is attached when the canvas mounts but
     * has not necessarily committed its navigation yet, and the URL is `about:
     * blank` until it does.
     */
    await expect
      .poll(() => canvasFrameUrls(page), {
        message: "the canvas never loaded the page's own route",
      })
      .toEqual([expect.stringContaining("/blogs/blog1")]);

    // And it is the app's render of that route, not an empty frame.
    const frame = page
      .frames()
      .find((candidate) => candidate.url().includes("/blogs/blog1"));
    expect(frame, "the canvas frame went away").toBeTruthy();
    /*
     * A first-request compile, not a slow assertion.
     *
     * This is the first time anything in the suite asks for `/blogs/blog1`,
     * and `next dev` compiles a route the first time it is requested — the
     * same reason the test timeout here is 90s. The poll above waited for the
     * frame to COMMIT its navigation, which happens long before the server has
     * anything to send, so this is the wait for the compile and the render.
     *
     * `expect`'s default is 20s (see `playwright.config.ts`), which is enough
     * on a warm developer machine and is not on a cold CI runner: this
     * assertion was the last red test in the suite's first real CI run, while
     * passing locally every time.
     */
    await expect(frame!.locator("body")).toContainText("Blog 1", {
      timeout: 60_000,
    });

    // Closing puts the editor back at full width, and leaves it on the same
    // page: the way out lands where the way in started.
    await studio.getByRole("button", { name: "Exit Preview" }).click();
    await expect(title).toHaveValue("Blog 1");
  });

  /**
   * The divider between the editor and the canvas.
   *
   * Both ends of its range matter and fail differently. Dragged in, the editor
   * stops being an editor — labels wrap, the rich text toolbar collapses — so
   * there is a floor. Dragged out, the canvas becomes a sliver that is not a
   * preview of anything, so there is a ceiling. A divider with neither looks
   * fine in a screenshot taken halfway along.
   */
  test("resizes between the editor and the canvas, within limits", async ({
    page,
  }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");
    await studio.getByRole("button", { name: "Canvas" }).click();
    await expect(
      studio.getByRole("button", { name: "Fit page to screen" }),
    ).toBeVisible();

    const divider = studio.getByRole("separator", {
      name: "Resize the editor and canvas",
    });
    await expect(divider).toBeVisible();

    /**
     * Drag the divider to an absolute x, and report where it ended up.
     *
     * The position is polled rather than read once: the release is a React
     * state change, so reading immediately after `mouse.up` can catch the
     * pre-commit position and report that nothing moved.
     */
    const dividerX = async (): Promise<number> =>
      (await divider.boundingBox())!.x;

    /**
     * Wait for the divider to stop moving before touching it.
     *
     * Opening the canvas animates the column across, so for a third of a second
     * the divider is travelling. Grabbing it mid-flight puts the pointer down
     * where the divider *was*, the drag lands on the canvas behind it, and the
     * failure reads as "resize is broken" rather than "the test was early". The
     * toolbar is no help as a signal — it is mounted before the column moves.
     */
    const settled = async (): Promise<number> => {
      let previous = -1;
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = Math.round(await dividerX());
        if (x === previous) return x;
        previous = x;
        await page.waitForTimeout(100);
      }
      throw new Error("the divider never stopped moving");
    };

    const dragTo = async (x: number): Promise<number> => {
      const from = await dividerX();
      const box = await divider.boundingBox();
      const y = box!.y + box!.height / 2;
      await page.mouse.move(box!.x + box!.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 10 });
      await page.mouse.up();
      // Settled: two reads in a row that agree, and not the position it
      // started from unless the drag was genuinely refused by a limit.
      await expect
        .poll(async () => Math.round(await dividerX()), { timeout: 5000 })
        .not.toBe(Math.round(from));
      return dividerX();
    };

    const start = await settled();

    // Out: the editor gets wider, and the divider follows the pointer.
    const wider = await dragTo(start + 240);
    expect(wider).toBeGreaterThan(start + 180);

    // Further than there is room for: it stops, leaving the canvas usable.
    const viewport = page.viewportSize();
    expect(viewport, "no viewport to measure against").toBeTruthy();
    const capped = await dragTo(viewport!.width + 500);
    expect(capped).toBeLessThan(viewport!.width - 200);

    // And back in past the floor: the editor keeps a usable width.
    const floored = await dragTo(0);
    expect(floored).toBeGreaterThan(200);

    // The editor is still an editor at every stop along the way.
    await expect(studio.locator("input").first()).toHaveValue("Blog 1");
  });

  /**
   * Preview mode, and what depends on it.
   *
   * Val only decorates a page with `data-val-path` when it is rendering draft
   * content, so without preview mode the canvas shows the published page and
   * nothing on it is selectable. That failure looks exactly like a broken
   * canvas, which is why the frame says so instead of showing nothing — and why
   * this test starts from preview off and turns it on, rather than assuming a
   * browser that already has the cookies.
   */
  test("turns preview mode on, then makes the page selectable", async ({
    page,
  }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");
    await studio.getByRole("button", { name: "Canvas" }).click();

    // A fresh browser has neither the Val Enable cookie nor draft mode, so the
    // page mounts none of Val's client code and never reports back. The canvas
    // has to notice that rather than sit on a spinner.
    const enable = studio.getByRole("button", {
      name: /Turn on preview mode/,
    });
    await expect(
      enable,
      "the canvas did not notice that preview mode was off",
    ).toBeVisible({ timeout: 25000 });
    await enable.click();

    /**
     * The switch to the fields view appears once the page has reported what is
     * on it — which is the real assertion here. It only exists if the enable
     * round trip worked, the page came back in draft mode, Val tagged its
     * content, and the frame's message reached the studio.
     */
    const fieldsTab = studio.getByRole("tab", { name: /Fields/ });
    await expect(
      fieldsTab,
      "the page never reported any content, so preview mode did not take",
    ).toBeVisible({ timeout: 30000 });
    await fieldsTab.click();

    /**
     * The reported fields, as real editable fields.
     *
     * Located by the `title`, which carries the whole source path: the visible
     * label is the field's own name, and a page can have several fields called
     * the same thing in different modules.
     */
    await expect(studio.getByText("On this page")).toBeVisible();
    const contentRow = studio
      .locator("[title$='.\"content\"']")
      .filter({ hasText: "content" })
      .first();
    await expect(
      contentRow,
      "the fields column did not render the reported fields",
    ).toBeVisible();

    // Picking from the column opens that field in the editor.
    await contentRow.click();
    await expect
      .poll(() => decodeURIComponent(page.url()), {
        message: "picking a field from the list did not open it",
      })
      .toContain('."content"');

    /**
     * And picking on the page itself, which is the point of the canvas.
     *
     * Clicked inside the frame, so this also proves the capture-phase handler
     * is intercepting: the element clicked here sits inside a link, and without
     * the intercept the frame would navigate instead of reporting.
     */
    const frame = page
      .frames()
      .find((candidate) => candidate.url().includes("val_canvas=1"));
    expect(
      frame,
      "the canvas frame was not marked as a canvas load",
    ).toBeTruthy();
    const tagged = frame!.locator("[data-val-path]");
    await expect(tagged.first()).toBeVisible();
    const picked = await tagged.first().getAttribute("data-val-path");
    expect(picked, "the page rendered no tagged content").toBeTruthy();
    await tagged.first().click({ force: true });
    await expect
      .poll(() => decodeURIComponent(page.url()), {
        message: "clicking the page did not open the field it belongs to",
      })
      .toContain(picked!.split(",")[0]);
  });

  /**
   * The canvas, as a link.
   *
   * "The third card down, zoom out a bit" is the thing a link is supposed to
   * replace, so the position is part of what a link carries — and the position
   * is the part that is easy to get wrong: the canvas is mounted closed and
   * opens a moment later, and the fit that follows will happily overwrite
   * exactly what the link was carrying.
   */
  test("carries its state in the URL, and restores it", async ({ page }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");
    await studio.getByRole("button", { name: /Open the canvas/ }).click();

    const enable = studio.getByRole("button", {
      name: /Turn on preview mode/,
    });
    await expect(enable).toBeVisible({ timeout: 25000 });
    await enable.click();
    const fieldsTab = studio.getByRole("tab", { name: /Fields/ });
    await expect(fieldsTab).toBeVisible({ timeout: 30000 });
    await fieldsTab.click();

    // Move the zoom off the fitted default, so restoring it proves something.
    await studio.getByRole("button", { name: "Zoom in" }).click();
    await studio.getByRole("button", { name: "Zoom in" }).click();
    const zoom = studio.locator("text=/^\\d+%$/").first();
    await expect(zoom).toBeVisible();
    // Settled: the zoom animates the canvas's own transform, and reading it
    // mid-change gives a number that is about to be replaced.
    await expect
      .poll(async () => zoom.textContent(), { timeout: 5000 })
      .not.toBe("100%");
    const zoomed = await zoom.textContent();

    /**
     * The URL says all of it, and says it once.
     *
     * Polled because the write is throttled: panning produces a value per
     * frame, and a `replaceState` per frame is both wasteful and, in some
     * browsers, rate limited into dropping the ones that matter. The URL only
     * has to be right by the time someone copies it.
     *
     * Polled on the ZOOM rather than on the view, and this is the whole
     * difference between a test that checks the link and one that checks
     * nothing: the view was set before the zoom, so a URL carrying
     * `canvas-view=fields` can still be carrying the position from before the
     * two clicks — and restoring that position looks exactly like a fit having
     * overruled the link.
     *
     * `p` belongs to the route, so carrying it as studio state as well would
     * name the module path twice.
     */
    const zoomedScale = (Number(zoomed!.replace("%", "")) / 100).toFixed(2);
    await expect
      .poll(() => decodeURIComponent(page.url()), {
        message: "the view state never reached the URL",
        timeout: 10000,
      })
      .toMatch(new RegExp(`canvas-at=${zoomedScale},`));
    expect(decodeURIComponent(page.url())).toMatch(/canvas-view=fields/);
    const url = page.url();
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("canvas=1");
    expect(decoded).toMatch(/canvas-at=[\d.]+,-?\d+,-?\d+/);
    expect(decoded.match(/[?&]p=/g)).toHaveLength(1);

    // And a fresh page on that URL is the same view.
    const restored = await page.context().newPage();
    await restored.goto(url);
    const restoredStudio = restored.locator("#val-shadow-root");
    await expect(
      restoredStudio.getByText("On this page"),
      "the link did not restore the canvas in its fields view",
    ).toBeVisible({ timeout: 30000 });
    await expect(
      restoredStudio.locator(`text=${zoomed}`).first(),
      "the link restored the canvas but not where it was looking",
    ).toBeVisible({ timeout: 10000 });
    await restored.close();
  });

  /**
   * The canvas off a route.
   *
   * A data module is not on a route, and that used to mean no canvas at all —
   * which had it backwards: a shared record is content some page renders, so
   * changing one is exactly when watching a page is worth having. With nothing
   * naming a route, the canvas opens on the site's root and the address bar
   * takes it anywhere else.
   */
  test("is offered off a route too, pointed at the root", async ({ page }) => {
    await openStudio(page, "/val/~/content/authors.val.ts");
    const studio = page.locator("#val-shadow-root");
    // The module is open — the canvas question is only meaningful once it is.
    // A record's rows, not "the first input": a record of authors renders a row
    // per key and has no field of its own to type into.
    await expect(studio.getByRole("button", { name: /Erlend/ })).toBeVisible({
      timeout: 30000,
    });

    const canvasButton = studio.getByRole("button", {
      name: /Open the canvas/,
    });
    await expect(
      canvasButton,
      "the canvas was not offered on a module that is not on a route",
    ).toBeVisible();
    await canvasButton.click();

    await expect(
      studio.getByLabel("Canvas route"),
      "the canvas opened somewhere other than the root",
    ).toHaveValue("/", { timeout: 30000 });
  });

  /**
   * Opening the canvas from a screen that is not a page.
   *
   * The compare and errors views are not on a route at all, and neither is a
   * data module — so the canvas opens on the site's root rather than on whatever
   * page happened to be open before. It used to remember the last page, which
   * made sense while the canvas stayed open across a non-page selection; it does
   * not stay open any more, so remembering produced a canvas opening on a page
   * you had left, from a screen with no relationship to it.
   */
  test("opens on the root from a view that is not a page", async ({ page }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");
    // On a page first, so "the root" is not just the default it started at.
    await studio.getByRole("button", { name: /Open the canvas/ }).click();
    await expect(studio.getByLabel("Canvas route")).toHaveValue(
      "/blogs/blog1",
      { timeout: 30000 },
    );

    // Off to a module that is not on a route.
    await openStudio(page, "/val/~/content/authors.val.ts");
    // The record renders its `select` title, so each row is a button named for
    // the author. The chain is cleared in `beforeAll` — without that, a leftover
    // patch from another suite renames this one and the test fails for a reason
    // that has nothing to do with the canvas.
    await expect(
      studio.getByRole("button", { name: "Theodor René Carlsen" }),
    ).toBeVisible({ timeout: 30000 });
    await studio.getByRole("button", { name: /Open the canvas/ }).click();
    await expect(
      studio.getByLabel("Canvas route"),
      "the canvas opened on a page that is not the one being edited",
    ).toHaveValue("/", { timeout: 30000 });
  });

  /**
   * Leaving the page for a view that is not one.
   *
   * The compare and errors views are the whole editor column and are not on a
   * route, so a canvas left open beside one is showing a page you are no longer
   * editing — and in the fields view it is worse than stale, because the column
   * IS the page's fields and the view you asked for would not appear at all.
   *
   * Compare rather than errors, because compare has a way in that does not
   * depend on the fixture being broken: make a change, and the quick actions
   * panel offers to review it. Both go through the same rule in `Shell` — the
   * selection is no longer a page — so this covers the errors view too.
   */
  test("leaves the canvas when the compare view is opened", async ({
    page,
    request,
  }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");

    // A change, so there is something to review.
    const title = studio.locator("input").first();
    await expect(title).toHaveValue("Blog 1");
    await title.fill("Blog 1 compared");

    await studio.getByRole("button", { name: /Open the canvas/ }).click();
    await expect(studio.getByLabel("Canvas route")).toHaveValue(
      "/blogs/blog1",
      { timeout: 30000 },
    );

    await studio.getByRole("button", { name: "Quick actions" }).click();
    await studio.getByRole("button", { name: /Review \d+ change/ }).click();

    await expect(
      studio.getByRole("button", { name: "Exit Preview" }),
      "the canvas stayed open beside a view that is not a page",
    ).not.toBeVisible();

    // The change was only ever a way in to the compare view, and the tests
    // below read the fixture's own values.
    await clearPatchChain(request);
  });

  /**
   * The address bar's suggestions, clicked rather than typed.
   *
   * Worth its own test because it broke in a way that looked like nothing at
   * all: the list opened, the highlight followed the mouse, and pressing a row
   * did nothing. The studio renders in a shadow root, so a `pointerdown`
   * listener on `document` sees the shadow HOST as its target — the containment
   * check meant to spare presses on the list rejected every one of them, and the
   * list dismissed itself before the press could reach a row. Enter kept working
   * throughout, which is exactly why a keyboard-only test would have missed it.
   */
  test("goes where a clicked route suggestion says", async ({ page }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");
    await studio.getByRole("button", { name: /Open the canvas/ }).click();

    const route = studio.getByLabel("Canvas route");
    await expect(route).toHaveValue("/blogs/blog1", { timeout: 30000 });
    await route.click();
    // Narrowed to the route being picked. The list filters on what is in the
    // bar, so the route the canvas is already on matches only itself and there
    // would be nothing to pick; and a broad filter can match more routes than
    // the list shows at once, which is a different thing from a broken list.
    await route.fill("/blogs/blog2");

    const suggestion = studio.getByRole("option", { name: "/blogs/blog2" });
    await expect(
      suggestion,
      "the tracked routes were not offered",
    ).toBeVisible();
    await suggestion.click();

    await expect(
      route,
      "pressing a suggestion did not move the canvas",
    ).toHaveValue("/blogs/blog2");

    /**
     * And the editor follows, because Val knows this route.
     *
     * The two used to come apart: the frame moved and `p` stayed on whatever
     * page was open, so the fields beside the canvas were a different page's —
     * which reads as the bar having picked the wrong route rather than as the
     * canvas and the editor having disagreed.
     */
    await expect
      .poll(() => new URL(page.url()).searchParams.get("p"), {
        message: "the editor did not follow the route that was picked",
        timeout: 15000,
      })
      .toBe('"/blogs/blog2"');
    await expect
      .poll(() => canvasFrameUrls(page).join(" "), {
        message: "the frame did not follow the route that was picked",
        timeout: 30000,
      })
      .toContain("/blogs/blog2");
  });

  /**
   * The other half of the Preview split button.
   *
   * Through `/api/val/enable` rather than straight to the page, so the tab lands
   * on the route already in preview mode — the unpublished work is the only
   * reason to open a preview rather than the site itself.
   *
   * The same shadow-root dismissal as the suggestions above killed this one too:
   * the menu opened and its items did nothing, so what is asserted is that a tab
   * actually arrives.
   */
  test("opens the page in a new tab, in preview mode", async ({ page }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");

    await studio.getByRole("button", { name: "Other ways to preview" }).click();
    const item = studio.getByRole("menuitem", { name: /Open in a new tab/ });
    await expect(item).toBeVisible();

    const opened = page.context().waitForEvent("page", { timeout: 20000 });
    await item.click();
    const tab = await opened;
    await tab.waitForLoadState("domcontentloaded");

    // The enable endpoint redirects, so the tab ends up on the page itself
    // rather than sitting on the endpoint.
    expect(tab.url()).toContain("/blogs/blog1");
    expect(
      tab.url(),
      "the tab stopped at the enable endpoint instead of redirecting",
    ).not.toContain("/api/val/enable");
    await tab.close();
  });

  /**
   * A field opened from the fields view, then read in the module editor.
   *
   * The two views are two ways of looking at the same field, so the field has to
   * survive the switch — and the module editor has to show the page it is on,
   * not the field by itself. Opening the exact path did the latter: pick a title
   * and the rest of the page disappeared from the editor, which is the opposite
   * of what picking something is for.
   *
   * What makes both true at once is that the route names the module and carries
   * the field beside it, so `field=` in the URL is the thing being checked as
   * much as what is on screen.
   */
  test("opens a picked field in its page, and stays on it across views", async ({
    page,
  }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");
    await studio.getByRole("button", { name: /Open the canvas/ }).click();

    const enable = studio.getByRole("button", {
      name: /Turn on preview mode/,
    });
    await expect(enable).toBeVisible({ timeout: 25000 });
    await enable.click();
    const fieldsTab = studio.getByRole("tab", { name: /Fields/ });
    await expect(fieldsTab).toBeVisible({ timeout: 30000 });
    await fieldsTab.click();

    // A field nested inside the page, so the ancestor the editor opens at is
    // several steps up rather than the field's own parent.
    const row = studio.getByRole("button", { name: "link › label" });
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.click();

    await expect
      .poll(() => decodeURIComponent(page.url()), {
        message: "the picked field did not reach the URL",
        timeout: 10000,
      })
      .toMatch(/field=.*"link"\."label"/);
    /**
     * The module, not the field: `p` stops at the page's own entry.
     *
     * Read as params rather than matched against the whole URL — `field` carries
     * a source path, so its value contains a `p=` of its own and a substring
     * match on the URL cannot tell the two apart.
     */
    const params = new URL(page.url()).searchParams;
    expect(
      params.get("p"),
      "the editor opened at the field instead of the page it is on",
    ).toBe('"/blogs/blog1"');
    expect(params.get("field")).toContain('"link"."label"');

    // Back in the module editor: the whole page, with the field still marked.
    await studio.getByRole("tab", { name: /Normal/ }).click();
    await expect(
      studio.locator("[data-val-studio-path*='\"content\"']").first(),
      "the editor showed the picked field alone, without the rest of its page",
    ).toBeVisible({ timeout: 30000 });
    await expect(
      studio.locator("[data-val-studio-path*='\"label\"']").first(),
    ).toBeVisible();

    /**
     * And it is actually in view, not merely rendered.
     *
     * The scroll used to be computed from `offsetTop`, which is measured from
     * the nearest positioned ancestor — and the field tree has plenty of them —
     * so it reported a fraction of the distance to the scroll container. The
     * scroll stopped short and left the field below the fold, which reads as
     * "the navigation did nothing".
     */
    // Polled: the scroll is smooth, so a single read lands mid-animation and
    // reports wherever the field happened to be on the way.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const root = document.getElementById("val-shadow-root")?.shadowRoot;
            const container = root?.getElementById("val-content-area");
            const field = root?.querySelector(
              "[data-val-studio-path*='\"label\"']",
            );
            if (!container || !field) return "not-found";
            const outer = container.getBoundingClientRect();
            const inner = field.getBoundingClientRect();
            if (inner.top < outer.top) return "above the top";
            if (inner.bottom > outer.bottom) return "below the bottom";
            return "in view";
          }),
        {
          message: "the field never reached the editor's visible area",
          timeout: 10000,
        },
      )
      .toBe("in view");
  });

  /**
   * Picking has its own control.
   *
   * It used to follow from the view, so selecting something on the page cost you
   * the module editor, and reading the page normally cost you the ability to
   * point at any of it. The view still sets the default — each has an obvious
   * one — and the button is how you disagree with it.
   */
  test("lets picking be turned on without leaving the normal view", async ({
    page,
  }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");
    await studio.getByRole("button", { name: /Open the canvas/ }).click();

    const enable = studio.getByRole("button", {
      name: /Turn on preview mode/,
    });
    await expect(enable).toBeVisible({ timeout: 25000 });
    await enable.click();
    await expect(studio.getByRole("tab", { name: /Fields/ })).toBeVisible({
      timeout: 30000,
    });

    // Off in the normal view: the page is there to be read and clicked through
    // like a page.
    const pick = studio.getByRole("button", { name: "Select on the page" });
    await expect(pick, "picking had no control of its own").toBeVisible();
    await pick.click();

    await expect(
      studio.getByRole("button", { name: "Stop selecting on the page" }),
      "the button did not turn picking on",
    ).toBeVisible();
    // Still the normal view — that is the whole point of the button.
    await expect(studio.getByRole("tab", { name: /Normal/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Switching to the fields view still turns it on by itself.
    await studio.getByRole("tab", { name: /Fields/ }).click();
    await expect(
      studio.getByRole("button", { name: "Stop selecting on the page" }),
    ).toBeVisible();
  });
});
