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

/**
 * A managed project's row, rendered.
 *
 * The state is derived in `Deployments.tsx` and tested there; what this adds is
 * that the derivation reaches the DOM — the row is one of three places the same
 * publish is narrated, and the prop has to be threaded to each of them.
 */
describe("a managed project's row", () => {
  test("says Saved, not yet live where a connected one says Building", () => {
    // `isLive: false` explicitly: this file's fixture is live by default, and
    // `isLive` outranks `state` -- Val having seen the site answer with a
    // commit is the one answer it can get for itself. A live row is neither
    // building nor saved-not-live, whichever project it belongs to.
    const unfinished = deployment({
      commitSha: "abc",
      state: "pending",
      isLive: false,
    });
    const { unmount } = render(
      <DeploymentRows deployments={[unfinished]} studioIsDeployer />,
    );
    expect(screen.getByText(/Saved, not yet live/)).toBeTruthy();
    expect(screen.queryByText(/Building/)).toBeNull();
    unmount();

    render(<DeploymentRows deployments={[unfinished]} />);
    expect(screen.getByText(/Building/)).toBeTruthy();
  });
});

describe("finishing a publish whose build never ran", () => {
  /*
   * `Saved, not yet live` is the one row state that needs an action. In
   * managed mode nothing outside the browser will ever resolve it -- there is
   * no host to notice the commit -- so a row that only named the state would
   * be telling someone to wait for something that is not coming.
   */
  const stuck = deployment({
    commitSha: "def4567",
    isLive: false,
    state: "pending",
  });

  test("offered on the stuck row, naming that row's commit", async () => {
    const finished: string[] = [];
    render(
      <DeploymentRows
        deployments={[stuck]}
        studioIsDeployer
        onFinishPublishing={(commitSha) => finished.push(commitSha)}
      />,
    );
    const button = screen.getByRole("button", { name: "Finish publishing" });
    button.click();
    // The row's own commit, not "the latest": a project can be stuck at more
    // than one, and a single button could only ever mean one of them.
    expect(finished).toEqual(["def4567"]);
  });

  test("not offered for a connected project", () => {
    // There a host really does pick the commit up, so the row is `Building`
    // and there is nothing for anyone here to finish.
    render(
      <DeploymentRows
        deployments={[stuck]}
        onFinishPublishing={() => undefined}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("not offered where the surface has no action to give", () => {
    // The settings sheet lists publishes to look at. Absent the prop, the row
    // says the state and offers nothing, exactly as it did before.
    render(<DeploymentRows deployments={[stuck]} studioIsDeployer />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("held while a build is already running", () => {
    // One deploy at a time, and the guard is shared -- so a second row's
    // button is held too, not just the one that was pressed.
    render(
      <DeploymentRows
        deployments={[
          stuck,
          deployment({ commitSha: "aaa1111", isLive: false, state: "pending" }),
        ]}
        studioIsDeployer
        onFinishPublishing={() => undefined}
        publishing
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Publishing…" });
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(
      true,
    );
  });
});
