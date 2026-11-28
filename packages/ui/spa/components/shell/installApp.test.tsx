/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AccountPanel } from "./AccountPanel";
import type { StudioInstall } from "../../studioApp/studioApp";
import { isIosSafari, studioAppIconOf } from "../../studioApp/studioApp";
import { readThemeSettings } from "../../hooks/themeSettings";

/**
 * Putting the Studio on the home screen, from the account panel: the panel
 * that is per person and per device.
 */

function panel(install: StudioInstall | undefined, mobile = true) {
  return (
    <AccountPanel
      breakpoint={mobile ? "mobile" : "desktop"}
      theme="dark"
      onThemeChange={() => undefined}
      autoSave={false}
      install={install}
      onClose={() => undefined}
    />
  );
}

describe("installing the Studio", () => {
  test("asks the browser to install it, where the browser offered to", () => {
    const install = jest.fn(async () => undefined);
    render(panel({ kind: "prompt", install }));
    fireEvent.click(screen.getByRole("button", { name: /Add to home/ }));
    expect(install).toHaveBeenCalledTimes(1);
    // The browser's own dialog asks; there is nothing of ours to show.
    expect(
      screen.queryByRole("dialog", { name: "Add to Home Screen" }),
    ).toBeNull();
  });

  test("on a computer it is installing an app, not a home screen", () => {
    render(panel({ kind: "prompt", install: async () => undefined }, false));
    expect(screen.getByRole("button", { name: /Install app/ })).not.toBeNull();
  });

  test("on an iPhone, shows the taps Safari needs in a dialog, since nothing can ask for them", () => {
    render(panel({ kind: "ios" }));
    expect(
      screen.queryByRole("dialog", { name: "Add to Home Screen" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add to home/ }));
    const dialog = screen.getByRole("dialog", { name: "Add to Home Screen" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
    expect(within(dialog).getByText(/Share/)).not.toBeNull();
  });

  test("is not offered where it cannot be done, or already has been", () => {
    render(panel({ kind: "none" }));
    expect(screen.queryByText("This device")).toBeNull();
  });
});

describe("isIosSafari", () => {
  const nav = (userAgent: string, maxTouchPoints = 0) => ({
    userAgent,
    maxTouchPoints,
  });
  test("an iPhone's Safari, and an iPad asking for the desktop site", () => {
    expect(
      isIosSafari(
        nav(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        ),
      ),
    ).toBe(true);
    expect(
      isIosSafari(
        nav(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
          5,
        ),
      ),
    ).toBe(true);
  });
  test("not a Mac, and not Chrome on an iPhone", () => {
    expect(
      isIosSafari(
        nav(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        ),
      ),
    ).toBe(false);
    expect(
      isIosSafari(
        nav(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
        ),
      ),
    ).toBe(false);
  });
});

describe("the project's logo as the app's icon", () => {
  const logo = { path: "/public/val/brand/mark_a1b2c.png", alt: null };
  const png = { width: 512, height: 512, mimeType: "image/png" };
  const published = new Map<string, string>();

  test("a published, square mark big enough to install with", () => {
    expect(studioAppIconOf(logo, png, published)).toEqual({
      src: "/val/brand/mark_a1b2c.png",
      type: "image/png",
      sizes: "512x512",
    });
  });

  test("an SVG is any size", () => {
    expect(
      studioAppIconOf(
        { path: "/public/val/brand/mark.svg", alt: null },
        { mimeType: "image/svg+xml" },
        published,
      ),
    ).toMatchObject({ type: "image/svg+xml", sizes: "any" });
  });

  test("a remote logo is its own URL", () => {
    const path = "https://remote.val.build/file/p/x/mark.png";
    expect(studioAppIconOf({ path, alt: null }, png, published)?.src).toBe(
      path,
    );
  });

  test("keeps Val's for a logo it could not stand on a home screen", () => {
    // Only this session can read a logo that is not published yet.
    expect(
      studioAppIconOf(logo, png, new Map([[logo.path, "patch-1"]])),
    ).toBeNull();
    // A wordmark.
    expect(
      studioAppIconOf(logo, { ...png, width: 800, height: 200 }, published),
    ).toBeNull();
    // Too small for the browser to offer to install it.
    expect(
      studioAppIconOf(logo, { ...png, width: 64, height: 64 }, published),
    ).toBeNull();
    // Dimensions never read from the bytes.
    expect(
      studioAppIconOf(logo, { mimeType: "image/png" }, published),
    ).toBeNull();
    expect(studioAppIconOf(null, png, published)).toBeNull();
  });
});

describe("readThemeSettings, for the app icon", () => {
  test("keeps what was read from the logo's bytes beside it", () => {
    expect(
      readThemeSettings({
        theme: {
          logo: {
            path: "/public/val/brand/mark_a1b2c.png",
            width: 512,
            height: 512,
            mimeType: "image/png",
          },
        },
      }).logoImage,
    ).toEqual({ width: 512, height: 512, mimeType: "image/png" });
  });
});
