/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountPanel } from "./AccountPanel";
import type { StudioInstall } from "../../studioApp/studioApp";
import { isIosSafari } from "../../studioApp/studioApp";

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
    fireEvent.click(
      screen.getByRole("button", { name: /Add Val to Home Screen/ }),
    );
    expect(install).toHaveBeenCalledTimes(1);
  });

  test("on a computer it is installing an app, not a home screen", () => {
    render(panel({ kind: "prompt", install: async () => undefined }, false));
    expect(
      screen.getByRole("button", { name: /Install Val as an app/ }),
    ).not.toBeNull();
  });

  test("on an iPhone, says the two taps Safari needs, since nothing can ask for them", () => {
    render(panel({ kind: "ios" }));
    expect(screen.queryByText("Add to Home Screen")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Add Val to Home Screen/ }),
    );
    expect(screen.getByText("Share")).not.toBeNull();
    expect(screen.getByText("Add to Home Screen")).not.toBeNull();
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
