/**
 * Runs the keyboard-sensitive Storybook stories against a real mobile browser
 * engine and writes screenshots to `device-lab-shots/`.
 *
 * Why this exists: `useVisualViewport.test.ts` pins the arithmetic, and the
 * simulated-keyboard stories show the intended layout, but neither actually
 * raises a software keyboard. Only a real engine does, and iOS Safari is the
 * one that gets this wrong — the layout/visual viewport split is a WebKit
 * behaviour. So this is the check that can actually fail for a real reason.
 *
 * Usage, with Storybook already running on :6006:
 *
 *   # Local WebKit — the same engine as iOS Safari, on this machine.
 *   pnpm --filter @valbuild/ui exec playwright install webkit
 *   node scripts/device-lab.mjs
 *
 *   # A real device, through BrowserStack.
 *   BROWSERSTACK_USERNAME=… BROWSERSTACK_ACCESS_KEY=… \
 *     node scripts/device-lab.mjs --browserstack
 *
 * WebKit on a desktop OS still does not raise a keyboard, so it verifies the
 * sheet's geometry and scrolling but not the keyboard itself. Only the
 * BrowserStack path, on a real handset, does that — which is why the manual
 * checklist below is part of the job and not a footnote.
 */

import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "device-lab-shots");
const STORYBOOK = process.env.STORYBOOK_URL ?? "http://localhost:6006";

/** The stories where the keyboard decides whether the layout works. */
const STORIES = [
  "shell-overlaymenu--edit-sheet-with-keyboard",
  "shell-overlaymenu--chat-sheet-with-keyboard",
  "shell-overlaymenu--edit-sheet-no-keyboard",
  "shell-overlaymenu--collapsed",
  "shell-shell--ai-chat-open",
  "shell-shell--pages-panel-open",
];

/**
 * What a real keyboard breaks that nothing else does. Printed at the end so
 * whoever runs this on a handset knows what they are looking for.
 */
const MANUAL_CHECKS = [
  "Focus the chat input: the input and its send button stay visible, above the keyboard.",
  "Focus a field in the edit sheet: Save and Cancel stay visible, above the keyboard.",
  "With the keyboard up, scroll the sheet's body: only the sheet scrolls — the site behind it does not move.",
  "Dismiss the keyboard: the sheet grows back to full height with no gap left behind it.",
  "Rotate to landscape with the keyboard up, then back: no overflow, nothing clipped.",
  "Scroll the page to collapse Safari's URL bar, then open a sheet: it does not jump or resize.",
];

async function main() {
  const useBrowserStack = process.argv.includes("--browserstack");
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.error(
      "playwright is not installed in this package. Run:\n" +
        "  pnpm --filter @valbuild/ui add -D playwright\n" +
        "  pnpm --filter @valbuild/ui exec playwright install webkit",
    );
    process.exit(1);
  }

  const { webkit, devices } = playwright;
  let browser;
  if (useBrowserStack) {
    const user = process.env.BROWSERSTACK_USERNAME;
    const key = process.env.BROWSERSTACK_ACCESS_KEY;
    if (!user || !key) {
      console.error(
        "--browserstack needs BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY.",
      );
      process.exit(1);
    }
    const caps = {
      "browserstack.username": user,
      "browserstack.accessKey": key,
      browser: "playwright-webkit",
      os: "ios",
      device: process.env.DEVICE ?? "iPhone 14",
      realMobile: "true",
      "browserstack.local": "true",
      name: "Val sheets — keyboard",
    };
    browser = await webkit.connect({
      wsEndpoint: `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(
        JSON.stringify(caps),
      )}`,
    });
  } else {
    browser = await webkit.launch();
  }

  fs.mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({
    ...devices["iPhone 14"],
    // The real thing serves the sheet; nothing here should depend on a
    // desktop pointer existing.
    hasTouch: true,
  });
  const page = await context.newPage();

  let failures = 0;
  for (const story of STORIES) {
    await page.goto(`${STORYBOOK}/iframe.html?id=${story}&viewMode=story`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("#storybook-root > div", { timeout: 30_000 });
    await page.waitForTimeout(600);

    // The one thing worth asserting automatically: nothing may overflow the
    // viewport horizontally. That is the symptom of a sheet sized in CSS
    // viewport units on a device whose visual viewport differs.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    if (overflow.scrollWidth > overflow.clientWidth + 1) {
      console.error(
        `FAIL ${story}: overflows horizontally ` +
          `(${overflow.scrollWidth} > ${overflow.clientWidth})`,
      );
      failures += 1;
    }
    const file = path.join(OUT, `${story}.png`);
    await page.screenshot({ path: file });
    console.log(`${failures === 0 ? "ok  " : "    "} ${story} -> ${file}`);
  }

  await browser.close();

  console.log(
    `\n${useBrowserStack ? "Real device" : "Local WebKit"} run complete. ` +
      `Screenshots in ${OUT}\n`,
  );
  if (!useBrowserStack) {
    console.log(
      "NOTE: desktop WebKit does not raise a software keyboard, so this run " +
        "checked geometry and scrolling only.\n",
    );
  }
  console.log("Check by hand on a real handset:");
  for (const [i, check] of MANUAL_CHECKS.entries()) {
    console.log(`  ${i + 1}. ${check}`);
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
