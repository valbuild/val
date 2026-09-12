import { expect, type Page } from "@playwright/test";
import { openStudio, patchThroughStore, test } from "./studio";

/**
 * The Studio, opened somewhere that is not a secure context.
 *
 * `crypto.randomUUID` and `navigator.clipboard` exist on `https://` and on
 * `localhost` and NOWHERE else — not "throw when used", absent — and a dev
 * server gets opened on a plain-http address that is not `localhost` routinely:
 * a phone on the LAN, a VM, or a browser on Windows reaching a dev server
 * inside WSL at `http://172.23.x.x:3000`. That last one is how this was
 * reported: a blank Studio and `crypto.randomUUID is not a function`, thrown
 * during the FIRST RENDER, because `useStatus` names its websocket connection
 * with one.
 *
 * Playwright cannot serve the app from an insecure origin without a second
 * server, so the context is simulated where it is actually observable: the two
 * globals are deleted before any of the page's own script runs. That is exactly
 * what the browser does there — `addInitScript` runs before the bundle, so the
 * bundle sees the same world it would over http on a LAN address.
 *
 * Both halves of the crash are covered: mounting (the connection id) and
 * editing (`PatchStore.newPatchId`), which is a separate call on a path no
 * render reaches.
 */

/** What a browser gives a page outside a secure context. */
async function makeInsecure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Deleted rather than set to undefined: `typeof crypto.randomUUID` has to
    // come back "undefined" the way it does in Firefox over plain http, and a
    // guard written as `in` would still pass against an own property.
    Reflect.deleteProperty(globalThis.crypto, "randomUUID");
    Reflect.deleteProperty(globalThis.Crypto.prototype, "randomUUID");
    Reflect.deleteProperty(globalThis.Navigator.prototype, "clipboard");
  });
}

test.describe("the Studio outside a secure context", () => {
  test("mounts, renders and can write a patch", async ({ page }) => {
    const thrown: string[] = [];
    page.on("pageerror", (error) => {
      thrown.push(error.message.split("\n")[0]);
    });

    await makeInsecure(page);
    await openStudio(page);

    // The simulation is the premise of everything below, so it is asserted
    // rather than assumed: a Playwright or Chromium change that puts either
    // global back would leave this test passing while testing nothing.
    expect(
      await page.evaluate(() => ({
        randomUUID: typeof globalThis.crypto.randomUUID,
        clipboard: typeof globalThis.navigator.clipboard,
      })),
    ).toEqual({ randomUUID: "undefined", clipboard: "undefined" });

    expect(
      await page.evaluate(() => {
        const host = document.getElementById("val-shadow-root");
        return host?.shadowRoot?.textContent ?? "";
      }),
    ).toMatch(/valbuild\/val-examples-next/);

    // A patch id is minted on a path no render reaches, so mounting is only
    // half of it. This throws if the store refuses the write.
    await patchThroughStore(page, "/content/tags.val.ts", [
      { op: "replace", path: ["changelog", "label"], value: "Insecure" },
    ]);

    expect(thrown, "uncaught in the page").toEqual([]);
  });
});
