/** @jest-environment jsdom */
import { render, renderHook, screen } from "@testing-library/react";
import { EnvVarsElement, useEnvVarsTarget } from "./EnvVars";
import { toEnvVarsHref } from "./shellDataMapping";

/**
 * `<val-env-vars>`, Val Build's variables and secrets for one project. jsdom
 * never defines the element, so this is also the Studio that could not reach
 * Val Build: what it shows is the link to the project's Variables section.
 */

const WC = "https://content.val.build/wc/v1";
const ENV_HREF = "https://admin.val.build/manage-env/acme/marketing-site";

// The Studio's providers are not under test, and loading them pulls in the
// whole store: only what the element reads is stood in for.
const mockConfig: { current: Record<string, string> | undefined } = {
  current: {
    project: "acme/marketing-site",
    appHost: "https://admin.val.build",
    contentHost: "https://content.val.build",
  },
};
const mockAccess = { current: { connected: true, studioMode: "http" } };
jest.mock("../ValProvider", () => ({ useValMode: () => "http" }));
jest.mock("../ValFieldProvider", () => ({
  useValConfig: () => mockConfig.current,
}));
jest.mock("./useValBuildAccess", () => ({
  useValBuildAccess: () => mockAccess.current,
}));

afterEach(() => {
  mockConfig.current = {
    project: "acme/marketing-site",
    appHost: "https://admin.val.build",
    contentHost: "https://content.val.build",
  };
  mockAccess.current = { connected: true, studioMode: "http" };
});

test("names the project, through the Studio's proxy, with Val Build's Variables as the fallback", () => {
  const { container } = render(
    <EnvVarsElement
      project="acme/marketing-site"
      envHref={ENV_HREF}
      webComponentsUrl={WC}
      studioMode="http"
      loadScript={() => Promise.resolve()}
    />,
  );
  const element = container.querySelector("val-env-vars");
  expect(element?.getAttribute("project")).toBe("acme/marketing-site");
  expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
  expect(element?.getAttribute("mode")).toBe("http");
  const link = screen.getByRole("link", {
    name: "Variables and secrets in Val Build",
  });
  expect(element?.contains(link)).toBe(true);
  expect(link.getAttribute("href")).toBe(ENV_HREF);
});

test("loads env-vars.js from Val Build", () => {
  const loadScript = jest.fn(() => Promise.resolve());
  render(
    <EnvVarsElement
      project="acme/marketing-site"
      envHref={ENV_HREF}
      webComponentsUrl={WC}
      loadScript={loadScript}
    />,
  );
  expect(loadScript).toHaveBeenCalledWith(`${WC}/env-vars.js`);
});

test("a connected project has somewhere to set them", () => {
  const { result } = renderHook(() => useEnvVarsTarget());
  expect(result.current).toEqual({
    project: "acme/marketing-site",
    envHref: ENV_HREF,
    webComponentsUrl: WC,
    studioMode: "http",
  });
});

test("a project that is not connected has no Variables tab, rather than one that goes nowhere", () => {
  mockConfig.current = {
    appHost: "https://admin.val.build",
    contentHost: "https://content.val.build",
  };
  expect(renderHook(() => useEnvVarsTarget()).result.current).toBeNull();
});

test("nor does one whose Val Build cannot be reached", () => {
  mockAccess.current = { connected: false, studioMode: "http" };
  expect(renderHook(() => useEnvVarsTarget()).result.current).toBeNull();
});

test("the link is the stable one admin redirects, and only for <org>/<project>", () => {
  expect(
    toEnvVarsHref({
      project: "acme/marketing-site",
      appHost: "https://admin.val.build/",
    }),
  ).toBe(ENV_HREF);
  expect(
    toEnvVarsHref({
      project: "marketing-site",
      appHost: "https://admin.val.build",
    }),
  ).toBeUndefined();
  expect(toEnvVarsHref(undefined)).toBeUndefined();
});
