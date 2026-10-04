/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { AiSetupElement } from "./AiSetup";
import { toAdminLinks } from "./shellDataMapping";

/**
 * `<val-ai-setup>`, Val Build's AI key setup for one project. jsdom never
 * defines the element, so this is also the Studio that could not reach
 * admin.val.build: what it shows is the link to the project's AI tab.
 */

const WC = "https://content.val.build/wc/v1";
const AI_HREF = "https://admin.val.build/manage-ai/acme/marketing-site";

// The Studio's providers are not under test, and loading them pulls in the
// whole store: only what the element reads is stood in for.
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock("../ValProvider", () => ({
  useRefreshAIModels: () => mockRefresh,
  useValMode: () => "fs",
}));
jest.mock("../ValFieldProvider", () => ({
  useValConfig: () => ({
    project: "acme/marketing-site",
    appHost: "https://admin.val.build",
    contentHost: "https://content.val.build",
  }),
}));
jest.mock("./useValBuildAccess", () => ({
  useValBuildAccess: () => ({ connected: true, studioMode: "fs" }),
}));

test("names the project, through the Studio's proxy, with the AI tab as the fallback", () => {
  const { container } = render(
    <AiSetupElement
      project="acme/marketing-site"
      aiHref={AI_HREF}
      webComponentsUrl={WC}
      studioMode="fs"
      loadScript={() => Promise.resolve()}
    />,
  );
  const element = container.querySelector("val-ai-setup");
  expect(element?.getAttribute("project")).toBe("acme/marketing-site");
  expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
  expect(element?.getAttribute("mode")).toBe("fs");
  const link = screen.getByRole("link", { name: "Set up AI in Val Build" });
  expect(element?.contains(link)).toBe(true);
  expect(link.getAttribute("href")).toBe(AI_HREF);
});

test("loads ai-setup.js from Val Build", () => {
  const loadScript = jest.fn(() => Promise.resolve());
  render(
    <AiSetupElement
      project="acme/marketing-site"
      aiHref={AI_HREF}
      webComponentsUrl={WC}
      loadScript={loadScript}
    />,
  );
  expect(loadScript).toHaveBeenCalledWith(`${WC}/ai-setup.js`);
});

test("a saved or removed key asks the assistant for its models again", () => {
  mockRefresh.mockClear();
  const { container } = render(
    <AiSetupElement
      project="acme/marketing-site"
      aiHref={AI_HREF}
      webComponentsUrl={WC}
      loadScript={() => Promise.resolve()}
    />,
  );
  container
    .querySelector("val-ai-setup")
    ?.dispatchEvent(
      new CustomEvent("val-ai-keys-changed", { bubbles: true, composed: true }),
    );
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test("the AI tab's link is the stable one admin redirects", () => {
  expect(
    toAdminLinks({
      project: "acme/marketing-site",
      appHost: "https://admin.val.build",
    })?.ai,
  ).toBe(AI_HREF);
});
