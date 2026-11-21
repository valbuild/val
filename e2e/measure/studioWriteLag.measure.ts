/**
 * What one field write costs the Studio: typing into the hero title of the
 * TanStack showcase's `/landing`, through "On this page", with a CPU profile.
 *
 * NOT a test, and named so that no Playwright project picks it up: it types
 * into real content and discards every unsaved patch when it is done. To run
 * it, against a dev server on 3458 that has NO unsaved patches (it refuses
 * to start otherwise):
 *
 *   cp e2e/measure/studioWriteLag.measure.ts e2e/tanstack/zzWriteLag.spec.ts
 *   pnpm exec playwright test --project=tanstack e2e/tanstack/zzWriteLag.spec.ts --trace off --reporter=line
 *   rm e2e/tanstack/zzWriteLag.spec.ts
 *
 * It prints, rather than asserts (see `scenarios/measure/README.md`): the
 * busy time per 250 ms of the run, and for each burst the app functions the
 * time was spent under. `LAG_OUT=<path>` also writes the raw `.cpuprofile`,
 * which Chrome DevTools opens.
 *
 * See `docs/plans/studio-write-lag.md` for what it found.
 */
import { expect } from "@playwright/test";
import { readdirSync, writeFileSync } from "node:fs";
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
const TYPED = " lagging or not";
const KEY_GAP_MS = 120;
const BUCKET_MS = 250;
/** A bucket busier than this is a burst, and is broken down. */
const BURST_MS = 50;

test.use({ viewport: { width: 1512, height: 900 } });

type ProfileNode = {
  id: number;
  callFrame: { functionName: string; url: string };
  children?: number[];
};
type Profile = {
  nodes: ProfileNode[];
  startTime: number;
  samples?: number[];
  timeDeltas?: number[];
};

test("one field write, profiled", async ({ page }) => {
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
    const w = window as unknown as {
      __updates: number;
      __long: { start: number; duration: number }[];
    };
    w.__updates = 0;
    window.addEventListener("message", (event) => {
      const data: unknown = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        data.type === "sourceUpdate"
      ) {
        w.__updates += 1;
      }
    });
    if (window === window.top) {
      w.__long = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__long.push({ start: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    }
  });

  await openStudio(page, STUDIO);
  await page.getByRole("button", { name: "Open the canvas" }).click();
  await expect(page.getByRole("tab", { name: /On this page \d/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Edit on the page" }).click();
  const frame = page.frameLocator('iframe[title="Preview of /landing"]');
  const title = frame.locator("main h1").first();
  const titleText = (await title.innerText()).trim();
  // A click on the page puts the cursor in its field
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
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const w = window as unknown as { __long: unknown[] };
    w.__long = [];
    const inner = document
      .getElementById("val-shadow-root")
      ?.shadowRoot?.querySelector("iframe")?.contentWindow;
    if (inner) Reflect.set(inner, "__updates", 0);
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  for (const character of TYPED) {
    await page.keyboard.type(character);
    await page.waitForTimeout(KEY_GAP_MS);
  }
  const typingMs = TYPED.length * KEY_GAP_MS;
  await page.waitForTimeout(3000);
  const { profile } = await cdp.send("Profiler.stop");
  expect(await active(), "the typing went into the title").toBe(
    titleText + TYPED,
  );

  const counts = await page.evaluate(() => {
    const w = window as unknown as {
      __long: { start: number; duration: number }[];
    };
    const inner = document
      .getElementById("val-shadow-root")
      ?.shadowRoot?.querySelector("iframe");
    return {
      longTasks: w.__long.map((task) => Math.round(task.duration)),
      updatesToPage: Number(
        Reflect.get(inner?.contentWindow ?? {}, "__updates") ?? 0,
      ),
      taggedOnPage:
        inner?.contentDocument?.querySelectorAll("[data-val-path]").length ?? 0,
    };
  });
  if (process.env.LAG_OUT) {
    writeFileSync(`${process.env.LAG_OUT}.cpuprofile`, JSON.stringify(profile));
  }
  console.log(report(profile, typingMs, TYPED.length, counts));
  await discardAll(page);
});

function report(
  profile: Profile,
  typingMs: number,
  keystrokes: number,
  counts: { longTasks: number[]; updatesToPage: number; taggedOnPage: number },
): string {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const buckets = new Map<number, number>();
  const burstFrames = new Map<number, Map<string, number>>();
  let time = 0;
  (profile.samples ?? []).forEach((sample, index) => {
    const delta = (profile.timeDeltas?.[index] ?? 0) / 1000;
    time += delta;
    const node = nodes.get(sample);
    if (!node || node.callFrame.functionName === "(idle)") return;
    const bucket = Math.floor(time / BUCKET_MS);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + delta);
    // Every app function on the stack, once
    const seen = new Set<string>();
    let current: number | undefined = sample;
    while (current !== undefined) {
      const frame = nodes.get(current)?.callFrame;
      if (frame && /\/(spa|src)\//.test(frame.url)) {
        const file = frame.url.split("?")[0]?.replace(/.*\/(spa|src)\//, "$1/");
        const key = `${frame.functionName || "(anonymous)"} @ ${file}`;
        if (!seen.has(key)) {
          seen.add(key);
          const frames = burstFrames.get(bucket) ?? new Map<string, number>();
          frames.set(key, (frames.get(key) ?? 0) + delta);
          burstFrames.set(bucket, frames);
        }
      }
      current = parents.get(current);
    }
  });
  const lines = [
    `${keystrokes} keystrokes over ${typingMs} ms, then 3 s idle`,
    `content updates sent to the page: ${counts.updatesToPage}`,
    `tagged elements on the page: ${counts.taggedOnPage}`,
    `long tasks (ms): ${counts.longTasks.join(", ") || "none"}`,
    `busy ms per ${BUCKET_MS} ms:`,
    "  " +
      Array.from(buckets.entries())
        .sort(([a], [b]) => a - b)
        .map(
          ([bucket, ms]) => `${(bucket * BUCKET_MS) / 1000}s:${Math.round(ms)}`,
        )
        .join(" "),
  ];
  for (const [bucket, ms] of Array.from(buckets.entries()).sort(
    ([a], [b]) => a - b,
  )) {
    if (ms < BURST_MS) continue;
    lines.push(
      `burst at ${(bucket * BUCKET_MS) / 1000}s, ${Math.round(ms)} ms busy:`,
    );
    const frames = Array.from(burstFrames.get(bucket)?.entries() ?? [])
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12);
    for (const [key, frameMs] of frames) {
      lines.push(`  ${Math.round(frameMs)} ms  ${key}`);
    }
  }
  return lines.join("\n");
}
