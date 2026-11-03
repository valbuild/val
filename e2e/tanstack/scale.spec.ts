import {
  expect,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { writeFileSync } from "node:fs";
import { navigateStudio, test } from "../studio";

/**
 * Phase 10 of `docs/plans/one-content-model.md`: the Studio at size, in a
 * real browser. A REPORT, not a gate: it measures and prints, and fails only
 * when it could not measure at all.
 *
 * The fixtures are `examples/tanstack/content/scale/`: a
 * `.jsonValues()` record of N posts that pick an image from a library, image,
 * file and video libraries of N entries each, and a page whose fields pick
 * from all three and point at one post. N is `VAL_E2E_SCALE`, read by the app
 * when its dev server starts, so the server has to be started for the run:
 *
 *   VAL_E2E_SCALE=1000 pnpm exec playwright test --project=tanstack e2e/tanstack/scale.spec.ts
 *   VAL_E2E_SCALE=10000 pnpm exec playwright test --project=tanstack e2e/tanstack/scale.spec.ts
 *
 * Nothing may be listening on the app's port (3458) beforehand: the suite
 * reuses a running server, and one started without `VAL_E2E_SCALE` has no
 * scale fixtures (the first test says so). Skipped when `VAL_E2E_SCALE` is not
 * set, so the `tanstack` project in CI never runs it.
 *
 * What each test measures: wall time from the browser's point of view, long
 * tasks (`PerformanceObserver("longtask")`, over 50 ms) while it ran, the
 * requests the page made, and the JS heap after it (CDP's `JSHeapUsedSize`
 * after a forced GC; Chromium only). Results are printed as a table and
 * written to `test-results/scale-<N>.json`.
 */

const SCALE = Number(process.env.VAL_E2E_SCALE || 0);
/** Generous: at 100,000 the question is whether it finishes at all. */
const STEP_TIMEOUT =
  SCALE >= 100_000 ? 600_000 : SCALE >= 10_000 ? 300_000 : 60_000;

test.skip(SCALE === 0, "VAL_E2E_SCALE is not set: see the comment above.");
test.describe.configure({ mode: "serial" });
test.setTimeout(STEP_TIMEOUT * 3);

type Row = {
  surface: string;
  ms: number | null;
  longTasks: number;
  longestTaskMs: number;
  longTaskTotalMs: number;
  heapMB: number | null;
  requests: Record<string, number>;
  note?: string;
};
const rows: Row[] = [];

test.afterAll(() => {
  if (rows.length === 0) return;
  const lines = [
    "",
    `Scale ${SCALE}:`,
    "| surface | ms | long tasks | longest (ms) | long-task total (ms) | heap (MB) | requests | note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.surface} | ${r.ms ?? "-"} | ${r.longTasks} | ${r.longestTaskMs} | ${r.longTaskTotalMs} | ${r.heapMB ?? "-"} | ${
          Object.entries(r.requests)
            .map(([k, n]) => `${n}× ${k}`)
            .join(", ") || "-"
        } | ${r.note ?? ""} |`,
    ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  writeFileSync(
    `test-results/scale-${SCALE}.json`,
    JSON.stringify({ scale: SCALE, rows }, null, 2),
  );
});

/** Long tasks, recorded from the first script on every page. */
async function observeLongTasks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const bag = window as unknown as {
      __valLongTasks: { start: number; duration: number }[];
    };
    bag.__valLongTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          bag.__valLongTasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Not Chromium: no long tasks to report.
    }
  });
}

async function takeLongTasks(
  page: Page,
): Promise<{ start: number; duration: number }[]> {
  return page.evaluate(() => {
    const bag = window as unknown as {
      __valLongTasks?: { start: number; duration: number }[];
    };
    const tasks = bag.__valLongTasks ?? [];
    bag.__valLongTasks = [];
    return tasks;
  });
}

/** The page's requests, grouped by what they are for. */
function countRequests(page: Page): {
  take: () => Record<string, number>;
} {
  let counts: Record<string, number> = {};
  const group = (request: Request): string => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/val/static")) return "studio assets";
    if (url.pathname.startsWith("/api/val/")) {
      const endpoint = url.pathname.slice("/api/val/".length).split("/")[0];
      return `${request.method()} /api/val/${endpoint}`;
    }
    if (url.pathname.startsWith("/val/scale/")) return "library files";
    if (url.port === "5173") return "studio assets";
    return "other";
  };
  page.on("request", (request) => {
    const name = group(request);
    counts[name] = (counts[name] ?? 0) + 1;
  });
  return {
    take: () => {
      const taken = counts;
      counts = {};
      return taken;
    },
  };
}

/** The JS heap after a forced GC, in MB (Chromium's CDP). */
async function heapMB(page: Page): Promise<number | null> {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("Performance.enable");
    const { metrics } = await cdp.send("Performance.getMetrics");
    await cdp.detach();
    const used = metrics.find((m) => m.name === "JSHeapUsedSize")?.value;
    return used === undefined
      ? null
      : Math.round((used / 1024 / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * One measured surface: `run` answers a note (or throws, and the row says
 * how it failed); long tasks and requests are what happened while it ran.
 */
async function measure(
  page: Page,
  requests: ReturnType<typeof countRequests>,
  surface: string,
  run: () => Promise<string | void>,
): Promise<boolean> {
  await takeLongTasks(page).catch(() => []);
  requests.take();
  const start = Date.now();
  let ms: number | null = null;
  let note: string | undefined;
  try {
    const result = await run();
    ms = Date.now() - start;
    if (typeof result === "string") note = result;
  } catch (error) {
    note = `did not finish: ${String(error).split("\n")[0]}`;
  }
  const tasks = await takeLongTasks(page).catch(() => []);
  rows.push({
    surface,
    ms,
    longTasks: tasks.length,
    longestTaskMs: Math.round(Math.max(0, ...tasks.map((t) => t.duration))),
    longTaskTotalMs: Math.round(tasks.reduce((sum, t) => sum + t.duration, 0)),
    heapMB: await heapMB(page),
    requests: requests.take(),
    ...(note !== undefined ? { note } : {}),
  });
  // As it goes, so a run that is killed (100,000) still says how far it got.
  process.stdout.write(`SCALE ROW ${JSON.stringify(rows.at(-1))}\n`);
  return ms !== null;
}

async function storesReceived(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bag = window as unknown as {
            __VAL_STORES__?: { received: boolean };
          };
          return bag.__VAL_STORES__?.received === true;
        }),
      { timeout: STEP_TIMEOUT },
    )
    .toBe(true);
}

/** The record list's own scroll viewport (`VirtualizedRecordList`). */
function recordViewport(page: Page) {
  return page
    .locator("#val-content-area div[style*='contain: strict']")
    .first();
}

/**
 * Scroll an element down in steps, a frame or so apart, as a reader's wheel
 * does: `scrollTop` rather than wheel events, so where the pointer is cannot
 * send the scroll to the column around it.
 */
async function scrollIn(
  target: Locator,
  steps: number,
  by: number,
): Promise<number> {
  for (let i = 0; i < steps; i++) {
    await target.evaluate((el, dy) => {
      el.scrollTop += dy;
    }, by);
    await target.page().waitForTimeout(50);
  }
  return target.evaluate((el) => el.scrollTop);
}

/** The nearest ancestor of `inner` that scrolls (the gallery's grid). */
async function scrollerOf(inner: Locator): Promise<Locator> {
  const marker = `scale-scroller-${Date.now()}`;
  const found = await inner.evaluate((node, mark) => {
    let current = node.parentElement;
    while (current !== null) {
      const style = getComputedStyle(current);
      if (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight
      ) {
        current.setAttribute("data-scale-scroller", mark);
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }, marker);
  if (!found) throw new Error("nothing scrolls around it");
  return inner.page().locator(`[data-scale-scroller="${marker}"]`);
}

test.describe(`the Studio with ${SCALE} entries`, () => {
  test("cold start, the record, the gallery, typing, search", async ({
    page,
  }) => {
    await observeLongTasks(page);
    const requests = countRequests(page);

    // A first load to let Vite compile what this route needs: not measured.
    await page.goto("/val");
    await storesReceived(page);

    // 1. Cold start to the first editable field, on the page that picks
    // from every library. A full page load: in this suite the Studio is
    // served by Vite's dev server, unbundled (a thousand module requests),
    // so this is a ceiling for a built Studio. Every later surface is
    // reached by navigating inside the Studio, as an editor does.
    const opened = await measure(
      page,
      requests,
      "cold start: first editable field (featured page, full page load)",
      async () => {
        await page.goto("/val/~/content/scale/featured.val.ts");
        const title = page
          .locator("#val-content-area")
          .getByRole("textbox")
          .first();
        await expect(
          title,
          "no scale fixtures: stop the dev server on :3458 and run again with VAL_E2E_SCALE set",
        ).toHaveValue("Featured", { timeout: STEP_TIMEOUT });
      },
    );
    expect(opened, "the Studio did not come up at this size").toBe(true);
    // Whatever the load started (validation, previews) settles first.
    await page.waitForTimeout(3_000);

    // 2. Typing in that field.
    await measure(
      page,
      requests,
      "typing 10 characters, 40 ms apart (featured title)",
      async () => {
        const title = page
          .locator("#val-content-area")
          .getByRole("textbox")
          .first();
        await title.click();
        await page.keyboard.press("End");
        await page.keyboard.type(" typed!!!!", { delay: 40 });
        await expect(title).toHaveValue("Featured typed!!!!");
        // Undo, so the next run starts from the same text.
        for (let i = 0; i < 10; i++) await page.keyboard.press("Backspace");
        await expect(title).toHaveValue("Featured");
        await page.waitForTimeout(1_500);
      },
    );

    // 3. The keyOf dropdown, naming every post.
    await measure(page, requests, "keyOf dropdown: open", async () => {
      const trigger = page
        .locator("#val-content-area")
        .getByRole("combobox")
        .first();
      await trigger.click({ timeout: 15_000 });
      const search = page.getByPlaceholder("Search key...");
      await expect(search).toBeVisible({ timeout: STEP_TIMEOUT });
      const options = await page.getByRole("option").count();
      await page.keyboard.press("Escape");
      return `${options} options rendered`;
    });

    // 4. The record list: opening it, then scrolling it.
    await measure(page, requests, "open the record list (posts)", async () => {
      await navigateStudio(page, "/val/~/content/scale/posts.val.ts");
      await expect(
        page.getByText("Post number 0", { exact: true }),
      ).toBeVisible({ timeout: STEP_TIMEOUT });
    });
    await measure(
      page,
      requests,
      "scroll the record list (40 steps of 1,500 px)",
      async () => {
        const top = await scrollIn(recordViewport(page), 40, 1_500);
        await page.waitForTimeout(1_000);
        return `scrolled to ${top}px`;
      },
    );

    // 5. The image library's gallery: opening it, then scrolling it.
    await measure(page, requests, "open the image gallery", async () => {
      await navigateStudio(page, "/val/~/content/scale/images.val.ts");
      await expect(page.getByText("image-0.png").first()).toBeVisible({
        timeout: STEP_TIMEOUT,
      });
      const images = await page.locator("#val-content-area img").count();
      return `${images} <img> in the content area`;
    });
    // 5a. Selecting an image: its "used by", which loads every post (a post
    // picks its image from this library). A bar while it loads, the gallery
    // usable meanwhile; done when the bar is gone.
    await measure(
      page,
      requests,
      'select an image: "used by" (loads every post)',
      async () => {
        await page.getByText("image-0.png").first().click();
        const loading = page.getByRole("progressbar", {
          name: "Looking for where it is used",
        });
        const sawBar = await loading
          .waitFor({ timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        await expect(loading).toHaveCount(0, { timeout: STEP_TIMEOUT });
        const failed = await page
          .getByText("Some content could not be loaded")
          .count();
        if (failed > 0) throw new Error("the load failed");
        return sawBar ? "progress bar shown" : "no progress bar seen";
      },
    );
    await page.keyboard.press("Escape");
    await measure(
      page,
      requests,
      "scroll the gallery (40 steps of 1,500 px)",
      async () => {
        const scroller = await scrollerOf(
          page.getByText("image-0.png").first(),
        );
        const top = await scrollIn(scroller, 40, 1_500);
        await page.waitForTimeout(1_000);
        const images = await page.locator("#val-content-area img").count();
        return `scrolled to ${top}px; ${images} <img> in the content area`;
      },
    );

    // 6. Search, which loads every post first.
    await navigateStudio(page, "/val/~/content/scale/featured.val.ts");
    await page.waitForTimeout(1_000);
    await measure(
      page,
      requests,
      "search: one query, until content results show",
      async () => {
        await page.getByRole("button", { name: "Search" }).first().click();
        await page
          .getByLabel("Search the project")
          .fill(`Post number ${SCALE - 1}`);
        const dialog = page.getByRole("dialog", { name: "Search" });
        const start = Date.now();
        await expect(dialog.getByText("In content")).toBeVisible({
          timeout: STEP_TIMEOUT,
        });
        const firstResults = Date.now() - start;
        // Every post loaded: the bar is gone (phase 10: a bar while the
        // content loads, results as they arrive).
        await expect(
          dialog.getByRole("progressbar", {
            name: "Loading content to search",
          }),
        ).toHaveCount(0, { timeout: STEP_TIMEOUT });
        await expect(dialog.getByText("Searching…")).toHaveCount(0, {
          timeout: STEP_TIMEOUT,
        });
        await expect(
          dialog.getByText(`Post number ${SCALE - 1}`, { exact: true }),
        ).toBeVisible({ timeout: STEP_TIMEOUT });
        return `first content results after ${firstResults} ms; ${await dialog.getByRole("button").count()} rows`;
      },
    );
  });
});
