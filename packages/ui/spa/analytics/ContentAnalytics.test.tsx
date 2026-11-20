/** @jest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { TooltipProvider } from "../components/designSystem/tooltip";

/**
 * Content analytics beside the content: asked of Val Build through this
 * app's admin proxy, once per module however many badges are in it, and not
 * at all where the Studio is not connected to Val Build.
 */

const mockClient = jest.fn();
let mockConnected = true;
jest.mock("../components/ValProvider", () => ({
  useClient: () => mockClient,
  useValMode: () => "http",
}));
jest.mock("../components/ValFieldProvider", () => ({
  useValConfig: () => ({ project: "acme/site" }),
}));
jest.mock("../components/shell/useValBuildAccess", () => ({
  useValBuildAccess: () => ({ connected: mockConnected }),
}));

import { ContentAnalyticsProvider } from "./ContentAnalyticsProvider";
import { ContentViewsBadge } from "./ContentViewsBadge";

const MODULE = "/content/blog.val.ts" as ModuleFilePath;
const at = (modulePath: string) => `${MODULE}?p=${modulePath}` as SourcePath;

const answer = {
  status: 200,
  json: {
    from: "2026-09-27",
    to: "2026-10-26",
    since: "2026-09-01T00:00:00.000Z",
    module: MODULE,
    live: { status: "past" },
    paths: [
      { path: at('"title"'), rendered: 1_500, viewed: 1_234 },
      { path: at('"body"'), rendered: 1_500, viewed: 300 },
    ],
    total: 2,
  },
};

function mount() {
  return render(
    <TooltipProvider>
      <ContentAnalyticsProvider>
        <ContentViewsBadge path={at('"title"')} />
        <ContentViewsBadge path={at('"body"')} />
        <ContentViewsBadge path={at('"never"')} />
      </ContentAnalyticsProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  mockClient.mockReset();
  mockConnected = true;
});

test("each field shows in how many page views it was seen, from one request for the module", async () => {
  mockClient.mockResolvedValue(answer);
  mount();
  await waitFor(() =>
    expect(screen.getAllByTestId("content-views")).toHaveLength(2),
  );
  expect(
    screen.getAllByTestId("content-views").map((badge) => badge.textContent),
  ).toEqual(["1.2k", "300"]);
  expect(mockClient).toHaveBeenCalledTimes(1);
  expect(mockClient).toHaveBeenCalledWith("/admin/proxy", "GET", {
    path: `/orgs/acme/projects/site/analytics/module?module=${encodeURIComponent(MODULE)}`,
    body: undefined,
    headers: { "x-val-studio": "1" },
  });
});

test("nothing is shown when Val Build says analytics is off, or does not answer", async () => {
  mockClient.mockResolvedValueOnce({
    status: 200,
    json: { ...answer.json, since: null },
  });
  const off = mount();
  await waitFor(() => expect(mockClient).toHaveBeenCalledTimes(1));
  expect(screen.queryAllByTestId("content-views")).toEqual([]);
  off.unmount();

  mockClient.mockRejectedValueOnce(new Error("fetch failed"));
  mount();
  await waitFor(() => expect(mockClient).toHaveBeenCalledTimes(2));
  expect(screen.queryAllByTestId("content-views")).toEqual([]);
});

test("a Studio not connected to Val Build asks nothing", () => {
  mockConnected = false;
  mount();
  expect(mockClient).not.toHaveBeenCalled();
  expect(screen.queryAllByTestId("content-views")).toEqual([]);
});
