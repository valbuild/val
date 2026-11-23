/**
 * What someone typing WITHOUT A PAUSE feels: the same field as
 * `studioWriteLag.measure.ts` (the hero title of the TanStack showcase's
 * `/landing`, through "On this page"), 59 keys 120 ms apart, so the field
 * writes in the middle of the typing (every 2 s, `FIELD_WRITE_MAX_WAIT_MS`).
 *
 * The other two scripts say what a write costs and who renders for it. This
 * one says whether it is FELT: how long each key took to reach the screen
 * (the Event Timing API's `duration` of the `keydown`: from the key to the
 * next paint), how long a key waited before it was handled at all, and the
 * long tasks while the typing went on. A key that lands during a write waits
 * for the write.
 *
 * NOT a test, and named so that no Playwright project picks it up: it types
 * into real content and discards every unsaved patch when it is done. To run
 * it, against a dev server on 3458 that has NO unsaved patches (it refuses
 * to start otherwise):
 *
 *   cp e2e/measure/studioTypingLatency.measure.ts e2e/tanstack/zzTyping.spec.ts
 *   pnpm exec playwright test --project=tanstack e2e/tanstack/zzTyping.spec.ts --trace off --reporter=line
 *   rm e2e/tanstack/zzTyping.spec.ts
 *
 * Run it once to warm the page up and read the runs after that. It prints,
 * rather than asserts (see `scenarios/measure/README.md`).
 *
 * See `docs/plans/studio-write-lag.md` for what it found.
 */
import { expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { discardAll, openStudio, test } from "../studio";

const MODULE = "/src/routes/_site.landing.val.ts";
const STUDIO = `/val/~${MODULE}?p=${encodeURIComponent('"/landing"')}`;
const PATCHES = path.join(
  __dirname,
  "..",
  "..",
  "examples",
  "tanstack",
  ".val",
  "patches",
);
const TYPED = " typing along without a pause, as people do when they write";
const KEY_GAP_MS = 120;

test.use({ viewport: { width: 1512, height: 900 } });

test("typing without a pause", async ({ page }) => {
  test.setTimeout(240_000);
  let entries: string[] = [];
  try {
    entries = readdirSync(PATCHES);
  } catch {
    // No patch directory: nothing to lose
  }
  const unsaved = entries.filter((entry) => entry !== "patches.log");
  expect(
    unsaved,
    "there are unsaved patches, which this would discard: save or discard them first",
  ).toEqual([]);

  await page.addInitScript(() => {
    if (window !== window.top) return;
    const keys: { duration: number; delay: number }[] = [];
    const long: number[] = [];
    Reflect.set(window, "__typing", { keys, long });
    // 16 ms is the least the browser reports; the default is 104, which
    // would leave out most keys. (`durationThreshold` is not in this
    // TypeScript's DOM types, so the options are not written inline.)
    const eventTiming = {
      type: "event",
      durationThreshold: 16,
      buffered: true,
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry instanceof PerformanceEventTiming)) continue;
        if (entry.name !== "keydown") continue;
        keys.push({
          duration: entry.duration,
          delay: entry.processingStart - entry.startTime,
        });
      }
    }).observe(eventTiming);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) long.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });

  await openStudio(page, STUDIO);
  await page.getByRole("button", { name: "Open the canvas" }).click();
  await expect(page.getByRole("tab", { name: /On this page \d/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Select on the page" }).click();
  const frame = page.frameLocator('iframe[title="Preview of /landing"]');
  const title = frame.locator("main h1").first();
  const titleText = (await title.innerText()).trim();
  await title.click();
  const active = () =>
    page.evaluate(() => {
      const element =
        document.getElementById("val-shadow-root")?.shadowRoot?.activeElement;
      return element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
        ? element.value
        : (element?.textContent ?? null);
    });
  await expect.poll(active, { timeout: 10_000 }).toBe(titleText);
  await page.keyboard.press("End");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const typing = Reflect.get(window, "__typing");
    typing.keys.length = 0;
    typing.long.length = 0;
  });
  for (const character of TYPED) {
    await page.keyboard.type(character);
    await page.waitForTimeout(KEY_GAP_MS);
  }
  // Read at the last key: what happened WHILE typing
  const typing: {
    keys: { duration: number; delay: number }[];
    long: number[];
  } = await page.evaluate(() => {
    const typing = Reflect.get(window, "__typing");
    return { keys: typing.keys.slice(), long: typing.long.slice() };
  });
  await page.waitForTimeout(3000);
  expect(await active()).toBe(titleText + TYPED);

  const durations = typing.keys
    .map((key) => key.duration)
    .sort((a, b) => a - b);
  const at = (p: number) =>
    durations[
      Math.min(durations.length - 1, Math.floor(durations.length * p))
    ] ?? 0;
  const delays = typing.keys.map((key) => key.delay);
  console.log(
    [
      `TYPING ${TYPED.length} keys, ${KEY_GAP_MS} ms apart`,
      `keys slower than 16 ms to the screen: ${durations.length} of ${TYPED.length}`,
      `key to screen (ms): median ${at(0.5)}, p90 ${at(0.9)}, worst ${durations[durations.length - 1] ?? 0}`,
      `keys over 100 ms: ${durations.filter((d) => d > 100).length}, over 200 ms: ${durations.filter((d) => d > 200).length}`,
      `worst wait before a key was even handled (ms): ${Math.round(Math.max(0, ...delays))}`,
      `long tasks while typing (ms): ${typing.long.map((d) => Math.round(d)).join(", ") || "none"}`,
      `long tasks total (ms): ${Math.round(typing.long.reduce((a, b) => a + b, 0))}`,
    ].join("\n"),
  );
  await discardAll(page);
});
