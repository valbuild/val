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
 * is wrong and how to fix it, and -- for the causes that are about remote
 * files alone -- that text edits still work. Those are the causes a save that
 * uploads no remote file does not depend on (`commitCarriesRemoteFiles` on
 * the server). The rest can be the network or the session, which stop saves
 * too, so the card must not promise it there.
 */
const SETUP_ONLY: RemoteFilesUnavailableReason[] = [
  "project-not-configured",
  "pat-error",
  "unauthorized-personal-access-token-error",
  "api-key-missing",
];
const MAYBE_EVERYTHING: RemoteFilesUnavailableReason[] = [
  "unknown-error",
  "error-could-not-get-settings",
  "no-internet-connection",
  "unauthorized",
];
const STILL_WORKS = "Text edits save and publish as normal.";

describe("RemoteFilesCard", () => {
  test.each(SETUP_ONLY)("%s says text edits still work", (reason) => {
    const copy = remoteFilesNoticeCopy(reason);
    expect(copy.title).not.toBe("");
    expect(copy.body).toContain(STILL_WORKS);
  });

  test.each(MAYBE_EVERYTHING)(
    "%s does not promise that anything works",
    (reason) => {
      const copy = remoteFilesNoticeCopy(reason);
      expect(copy.title).not.toBe("");
      expect(copy.body).not.toContain(STILL_WORKS);
    },
  );

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
