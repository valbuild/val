/** @jest-environment jsdom */

/**
 * The worker belongs to the installed app. In a tab it would only hide the
 * Studio's requests from test harnesses (WebKit sends every request of a
 * controlled page through its worker), so it is not registered there.
 */
function start(standalone: boolean): jest.Mock {
  const register = jest.fn(async () => undefined);
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { startStudioApp } = require("./studioApp");
    startStudioApp("/api/val");
  });
  return register;
}

describe("startStudioApp", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  test("links the manifest first, in a tab as well", () => {
    document.head.innerHTML = '<link rel="manifest" href="/site.webmanifest">';
    start(false);
    expect(
      document.head.querySelector('link[rel="manifest"]')?.getAttribute("href"),
    ).toBe("/api/val/manifest.webmanifest");
  });

  test("registers no worker in a browser tab", () => {
    expect(start(false)).not.toHaveBeenCalled();
  });

  test("registers the worker, scoped to the Studio, in the installed app", () => {
    expect(start(true)).toHaveBeenCalledWith("/api/val/studio-sw.js", {
      scope: "/val",
    });
  });
});
