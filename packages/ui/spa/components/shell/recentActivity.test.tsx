/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { UtilityPanel } from "./UtilityPanel";
import { ShellActivityEntry } from "./types";

/**
 * Recent activity, which is now edits AND publishes.
 *
 * The publishes were visible only in the status bar's deploy feed, which is a
 * live-progress indicator: it empties itself as builds land, so the moment a
 * publish finished there was nowhere in the Studio that said it had.
 *
 * What is pinned here is the two kinds of row being different kinds of thing —
 * an edit is somewhere to go, a publish is something that happened — because
 * that is the part a later refactor would flatten.
 */
const change: ShellActivityEntry = {
  kind: "change",
  id: "change-1",
  sourcePath: '/content/home.val.ts?p="hero"."title"',
  title: "home › hero › title",
  timestamp: "2 minutes ago",
  author: "Ada",
};

const deploy: ShellActivityEntry = {
  kind: "deploy",
  id: "deploy-abc1234",
  title: "Update the hero",
  state: "Live",
  progress: "settled",
  timestamp: "12 minutes ago",
  author: "Ida",
};

function panel(
  activity: ShellActivityEntry[],
  onSelectActivity: () => void = () => undefined,
) {
  return (
    <UtilityPanel
      breakpoint="desktop"
      activity={activity}
      onNewPage={() => undefined}
      onUploadMedia={() => undefined}
      onSelectActivity={onSelectActivity}
      onClose={() => undefined}
    />
  );
}

describe("recent activity", () => {
  test("lists publishes alongside changes", () => {
    render(panel([change, deploy]));
    expect(screen.queryByText("home › hero › title")).not.toBeNull();
    expect(screen.queryByText("Update the hero")).not.toBeNull();
  });

  test("says how a publish is doing, and who published it", () => {
    render(panel([deploy]));
    expect(screen.queryByText("Live · Ida · 12 minutes ago")).not.toBeNull();
  });

  test("a change is something to open", () => {
    const onSelectActivity = jest.fn();
    render(panel([change], onSelectActivity));
    screen.getByRole("button", { name: /home › hero › title/ }).click();
    expect(onSelectActivity).toHaveBeenCalledTimes(1);
  });

  test("a publish is not - there is nothing in the Studio a commit opens", () => {
    render(panel([deploy]));
    expect(
      screen.queryByRole("button", { name: /Update the hero/ }),
    ).toBeNull();
  });
});
