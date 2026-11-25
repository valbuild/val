/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  LogsElement,
  LogsInPreviewsPlace,
  useLogsTarget,
  type LogsTarget,
} from "./Logs";
import type { ValBuildAccess } from "./useValBuildAccess";

/**
 * `<val-logs>`, the hosted site's requests. jsdom never defines the element,
 * so this is also the Studio that could not reach Val Build: what it shows is
 * the link to the project's Logs in Val Build.
 */

const WC = "https://content.val.build/wc/v1";
const ADMIN = "https://admin.val.build/~/acme/marketing-site/logs";
const target: LogsTarget = {
  project: "acme/marketing-site",
  adminHref: ADMIN,
  webComponentsUrl: WC,
  studioMode: "http",
};
const noScript = () => Promise.resolve();

jest.mock("../ValFieldProvider", () => ({
  useValConfig: () => ({
    project: "acme/marketing-site",
    appHost: "https://admin.val.build",
    contentHost: "https://content.val.build",
  }),
}));

test("names the project, through the Studio's proxy, with its Logs in Val Build as the fallback", () => {
  const { container } = render(
    <LogsElement layout="summary" loadScript={noScript} {...target} />,
  );
  const element = container.querySelector("val-logs");
  expect(element?.getAttribute("project")).toBe("acme/marketing-site");
  expect(element?.getAttribute("api-base")).toBe("/api/val/admin/proxy");
  expect(element?.getAttribute("layout")).toBe("summary");
  expect(element?.getAttribute("mode")).toBe("http");
  expect(element?.getAttribute("admin-url")).toBe(ADMIN);
  const link = screen.getByRole("link", { name: "Logs in Val Build" });
  expect(element?.contains(link)).toBe(true);
  expect(link.getAttribute("href")).toBe(ADMIN);
});

test("loads logs.js from Val Build", () => {
  const loadScript = jest.fn(noScript);
  render(<LogsElement layout="page" loadScript={loadScript} {...target} />);
  expect(loadScript).toHaveBeenCalledWith(`${WC}/logs.js`);
});

test("Open logs in the summary is answered by the Studio", () => {
  const onOpen = jest.fn();
  const { container } = render(
    <LogsElement
      layout="summary"
      onOpen={onOpen}
      loadScript={noScript}
      {...target}
    />,
  );
  const element = container.querySelector("val-logs");
  act(() => {
    element?.dispatchEvent(
      new CustomEvent("val-open-logs", { bubbles: true, composed: true }),
    );
  });
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("the page in the preview's place has a way back to the preview", () => {
  const onClose = jest.fn();
  const { container } = render(
    <LogsInPreviewsPlace target={target} onClose={onClose} />,
  );
  expect(container.querySelector("val-logs")?.getAttribute("layout")).toBe(
    "page",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to the preview" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

describe("useLogsTarget", () => {
  function Probe({
    valBuild,
    hosted,
  }: {
    valBuild: ValBuildAccess;
    hosted: boolean;
  }) {
    const found = useLogsTarget(valBuild, hosted);
    return <p>{found === null ? "none" : found.adminHref}</p>;
  }

  test("is the project's Logs in Val Build, for a hosted site", () => {
    render(<Probe valBuild={{ connected: true, studioMode: "http" }} hosted />);
    expect(screen.getByText(ADMIN)).toBeTruthy();
  });

  test("is nothing for a site Val Build does not serve", () => {
    render(
      <Probe
        valBuild={{ connected: true, studioMode: "http" }}
        hosted={false}
      />,
    );
    expect(screen.getByText("none")).toBeTruthy();
  });

  test("is nothing when Val Build cannot be reached", () => {
    render(
      <Probe valBuild={{ connected: false, studioMode: "http" }} hosted />,
    );
    expect(screen.getByText("none")).toBeTruthy();
  });
});
