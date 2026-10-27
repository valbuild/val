/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { DeploymentRows, DeploymentsStatus } from "./Deployments";
import { ShellDeployment } from "./types";
import { TooltipProvider } from "../designSystem/tooltip";
import { StatusBar } from "./StatusBar";
import type { PublishIndicator } from "../../publish/publishIndicatorView";

/**
 * The rows of the deploy feed, which are a feed and not an inbox.
 *
 * Every row used to carry a dismiss button. That was a control for a list that
 * GREW - the client accumulated every deployment a session had ever seen, so
 * without clearing rows the list only got longer - and the feed is bounded now:
 * the content service returns the last few publishes and the client keeps the
 * newest few of those. What a row would be dismissed for is that it is old, and
 * being old is what takes it off the end on its own.
 */
const deployment = (
  overrides: Partial<ShellDeployment> & Pick<ShellDeployment, "commitSha">,
): ShellDeployment => ({
  state: "success",
  message: "Update the hero",
  timestamp: "12 minutes ago",
  updatedAt: "2026-08-25T11:48:00Z",
  isLive: true,
  ...overrides,
});

describe("the deploy feed's rows", () => {
  test("say what happened, and offer nothing to press", () => {
    render(<DeploymentRows deployments={[deployment({ commitSha: "abc" })]} />);
    expect(screen.queryByText("Update the hero")).not.toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("a finished publish has no dismiss control either", () => {
    // It was only offered on rows that were NOT building, which made the
    // control appear as a publish landed - just as it stopped being worth
    // looking at.
    render(
      <DeploymentRows
        deployments={[
          deployment({ commitSha: "abc", state: "failure", isLive: false }),
          deployment({ commitSha: "def", state: "pending", isLive: false }),
        ]}
      />,
    );
    expect(screen.queryByLabelText("Dismiss deployment")).toBeNull();
  });

  test("an empty feed explains itself rather than showing nothing", () => {
    render(<DeploymentRows deployments={[]} />);
    expect(screen.queryByText(/Nothing published yet/)).not.toBeNull();
  });
});

/**
 * A row says when its publish started, and nothing about how it went
 * (valbuild/home `docs/hosted-publishing.md`, step 10, decided 2026-10-11).
 *
 * The rows used to say Building, Built, Published, Live or Build failed each,
 * worked out per row and differently for managed and connected projects, while
 * the status bar above them said where the site actually was. The one status
 * is the bar's; the list is a list of publishes.
 */
describe("a row of the deploy feed", () => {
  test("says when it started, and nothing about how it went", () => {
    render(
      <DeploymentRows
        deployments={[
          deployment({
            commitSha: "abc",
            state: "pending",
            isLive: false,
            started: "3 minutes ago",
            author: "Ada",
          }),
          deployment({
            commitSha: "def",
            state: "failure",
            isLive: false,
            started: "an hour ago",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Started 3 minutes ago · Ada")).toBeTruthy();
    expect(screen.getByText("Started an hour ago")).toBeTruthy();
    for (const word of [/Building/, /Build failed/, /Published/, /Live/]) {
      expect(screen.queryByText(word)).toBeNull();
    }
  });

  test("without a start, says when it last changed", () => {
    render(<DeploymentRows deployments={[deployment({ commitSha: "abc" })]} />);
    expect(screen.getByText("12 minutes ago")).toBeTruthy();
  });
});

/**
 * The status bar item is the publish indicator: it spins while the site is on
 * its way to what was published, and says so in one of three words.
 */
describe("the publish indicator", () => {
  test("spins while every visitor has yet to get the change", () => {
    render(
      <TooltipProvider>
        <DeploymentsStatus
          deployments={[deployment({ commitSha: "new" })]}
          open={false}
          onOpenChange={jest.fn()}
          indicator={{ kind: "reaching", mine: true, everywhereAt: 0 }}
          studioIsDeployer
        />
      </TooltipProvider>,
    );
    expect(
      screen.queryByRole("button", {
        name: /^Deployments: Reaching edges \d+%$/,
      }),
    ).not.toBeNull();
    const progress = screen.getByRole("progressbar", {
      name: "Reaching edges",
    });
    expect(Number(progress.getAttribute("aria-valuenow"))).toBeGreaterThan(87);
  });

  test("rests at Live, without one, by the feed's own summary", () => {
    render(
      <TooltipProvider>
        <DeploymentsStatus
          deployments={[deployment({ commitSha: "new" })]}
          open={false}
          onOpenChange={jest.fn()}
        />
      </TooltipProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "Deployments: Live" }),
    ).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

/**
 * A project with no deploy feed still sees its own publish: the indicator
 * shows while something is under way or failed, and stays out of the way
 * otherwise.
 */
describe("the status bar with no deploy feed", () => {
  const bar = (indicator: PublishIndicator) => (
    <TooltipProvider>
      <StatusBar
        breakpoint="desktop"
        saveState="saved"
        mode="http"
        autoSave={false}
        onAutoSaveChange={jest.fn()}
        publishIndicator={indicator}
      />
    </TooltipProvider>
  );

  test("shows a publish under way", () => {
    render(
      bar({ kind: "publishing", mine: true, step: "Building", percent: 12 }),
    );
    expect(
      screen.queryByRole("button", { name: "Deployments: Publishing 12%" }),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("progressbar", { name: "Publishing" })
        .getAttribute("aria-valuenow"),
    ).toBe("12");
  });

  test("another editor's publish is an indeterminate progressbar", () => {
    render(bar({ kind: "publishing", mine: false, step: null, percent: null }));
    expect(
      screen
        .getByRole("progressbar", { name: "Publishing" })
        .hasAttribute("aria-valuenow"),
    ).toBe(false);
  });

  test("shows nothing at rest", () => {
    render(bar({ kind: "none" }));
    expect(screen.queryByRole("button", { name: /^Deployments:/ })).toBeNull();
  });
});
