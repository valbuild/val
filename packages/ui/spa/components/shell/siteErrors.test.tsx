/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { SiteErrors, SiteErrorsElement } from "./SiteErrors";
import { AccountPanel } from "./AccountPanel";

/**
 * `<val-site-errors>`, the hosted site's recent errors. jsdom never defines
 * the element, so this is also the Studio that could not reach Val Build:
 * what it shows is the link to the project's page there.
 */

const WC = "https://content.val.build/wc/v1";
const PROJECT_HREF = "https://admin.val.build/~/acme/marketing-site";

// The Studio's providers are not under test, and loading them pulls in the
// whole store: only what the element reads is stood in for.
let mockConnected = true;
jest.mock("../ValProvider", () => ({
  useValMode: () => "http",
}));
jest.mock("../ValFieldProvider", () => ({
  useValConfig: () => ({
    project: "acme/marketing-site",
    appHost: "https://admin.val.build",
    contentHost: "https://content.val.build",
  }),
}));
jest.mock("./useValBuildAccess", () => ({
  useValBuildAccess: () => ({ connected: mockConnected, studioMode: "http" }),
}));

test("names the project, through the Studio's proxy, with its Val Build page as the fallback", () => {
  const { container } = render(
    <SiteErrorsElement
      project="acme/marketing-site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      studioMode="http"
      loadScript={() => Promise.resolve()}
    />,
  );
  const element = container.querySelector("val-site-errors");
  expect(element?.getAttribute("project")).toBe("acme/marketing-site");
  expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
  expect(element?.getAttribute("mode")).toBe("http");
  const link = screen.getByRole("link", { name: "See this site in Val Build" });
  expect(element?.contains(link)).toBe(true);
  expect(link.getAttribute("href")).toBe(PROJECT_HREF);
});

test("loads site-errors.js from Val Build", () => {
  const loadScript = jest.fn(() => Promise.resolve());
  render(
    <SiteErrorsElement
      project="acme/marketing-site"
      projectHref={PROJECT_HREF}
      webComponentsUrl={WC}
      loadScript={loadScript}
    />,
  );
  expect(loadScript).toHaveBeenCalledWith(`${WC}/site-errors.js`);
});

test("is not mounted when Val Build cannot be reached", () => {
  mockConnected = false;
  try {
    const { container } = render(
      <SiteErrors loadScript={() => Promise.resolve()} />,
    );
    expect(container.querySelector("val-site-errors")).toBeNull();
  } finally {
    mockConnected = true;
  }
});

describe("in the account panel", () => {
  const panel = (siteErrors?: React.ReactNode) =>
    render(
      <AccountPanel
        breakpoint="desktop"
        theme="light"
        onThemeChange={() => undefined}
        autoSave={false}
        deployments={[]}
        siteErrors={siteErrors}
        onClose={() => undefined}
      />,
    );

  test("sits under the deploy feed when the project is hosted", () => {
    panel(<p>errors here</p>);
    expect(screen.getByText("errors here")).toBeTruthy();
  });

  test("is not there at all when it is not", () => {
    const { container } = panel(undefined);
    expect(container.textContent).not.toContain("errors here");
  });
});
