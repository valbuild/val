/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  RemoteFilesCard,
  remoteFilesNoticeCopy,
  type RemoteFilesUnavailableReason,
} from "./RemoteFilesNotice";

/**
 * Remote files being unavailable is SETUP, not a failure: the card says what
 * is wrong, that text edits still work, and how to fix it. The last two are
 * what kept the old banner from reading as anything but the studio breaking,
 * so every reason has to carry them.
 */
const REASONS: RemoteFilesUnavailableReason[] = [
  "unknown-error",
  "project-not-configured",
  "api-key-missing",
  "pat-error",
  "error-could-not-get-settings",
  "no-internet-connection",
  "unauthorized-personal-access-token-error",
  "unauthorized",
];

describe("RemoteFilesCard", () => {
  test.each(REASONS)("%s says text edits still work", (reason) => {
    const copy = remoteFilesNoticeCopy(reason);
    expect(copy.title).not.toBe("");
    expect(copy.body).toContain("Text edits save and publish as normal.");
  });

  test("no project id links to where one comes from", () => {
    render(
      <RemoteFilesCard reason="project-not-configured" onDismiss={jest.fn()} />,
    );
    expect(
      screen.getByRole("link", { name: /admin\.val\.build/ }),
    ).toHaveProperty("href", "https://admin.val.build/");
  });

  test("not logged in offers the command to run", () => {
    render(<RemoteFilesCard reason="pat-error" onDismiss={jest.fn()} />);
    expect(screen.getByText("npx -p @valbuild/cli val login")).toBeTruthy();
  });

  test("can be dismissed", () => {
    const onDismiss = jest.fn();
    render(
      <RemoteFilesCard reason="project-not-configured" onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
