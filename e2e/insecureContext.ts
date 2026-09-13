import { expect, type Page } from "@playwright/test";

/**
 * The Studio, opened somewhere that is not a secure context.
 *
 * `crypto.randomUUID` and `navigator.clipboard` exist on `https://` and on
 * `localhost` and NOWHERE else — not "throw when used", absent — and a dev
 * server gets opened on a plain-http address that is not `localhost` routinely:
 * a phone on the LAN, a VM, or a browser on Windows reaching a dev server
 * inside WSL at `http://172.23.x.x:3000`. That last one is how it was reported:
 * a blank Studio and `crypto.randomUUID is not a function`, thrown during the
 * FIRST RENDER, because `useStatus` names its websocket connection with one.
 *
 * ## Why this is simulated rather than served
 *
 * Playwright reaches the app over `localhost`, which is a secure context, and
 * always will be: binding the dev servers to a routable address to get an
 * insecure origin would make the suite depend on the runner's network. So the
 * context is simulated where it is observable — the globals are deleted before
 * any of the page's own script runs, which is exactly the world the bundle
 * boots into over plain http on a LAN address.
 *
 * This matters more than it sounds: EVERY other test in this suite runs in a
 * secure context, so this whole class of crash is invisible to all of them. A
 * smoke test on a second framework would not have caught it either.
 */
export async function makeInsecure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Deleted rather than set to undefined: `typeof crypto.randomUUID` has to
    // come back "undefined" the way it does in a browser over plain http, and a
    // guard written with `in` would still pass against an own property.
    Reflect.deleteProperty(globalThis.crypto, "randomUUID");
    Reflect.deleteProperty(globalThis.Crypto.prototype, "randomUUID");
    Reflect.deleteProperty(globalThis.Navigator.prototype, "clipboard");
  });
}

/**
 * That the simulation took.
 *
 * The premise of every assertion that follows it, so it is checked rather than
 * assumed: a Playwright or browser change that puts either global back would
 * leave the test passing while testing nothing.
 */
export async function expectInsecure(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => ({
      randomUUID: typeof globalThis.crypto.randomUUID,
      clipboard: typeof globalThis.navigator.clipboard,
    })),
  ).toEqual({ randomUUID: "undefined", clipboard: "undefined" });
}
