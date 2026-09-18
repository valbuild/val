/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { DeploymentRows } from "./Deployments";
import { ShellDeployment } from "./types";

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
