/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  CommitRefusedNotice,
  type BuildOnPushState,
  type CommitRefused,
} from "./CommitRefusedNotice";

/*
 * Somebody pushed to the proposal's branch: what the notice offers in each
 * state is only what can work ("An error says what the person can do about
 * it" in the codebase rules). Pressing Commit again would be refused the same
 * way, so there is never a bare Try again for the refusal itself.
 */
const refused = (during: CommitRefused["during"]): CommitRefused => ({
  branch: "val/p/0123456789abcdef0123",
  branchUrl: "https://github.com/acme/site/tree/val/p/0123456789abcdef0123",
  who: "Ada Lovelace",
  ago: "5 minutes ago",
  commit: {
    sha: "3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b",
    url: "https://github.com/acme/site/commit/3c4d5e6",
    message: "Fix the hero's spacing\n\nThe gap was 2rem.",
  },
  during,
});

function shown(
  during: CommitRefused["during"],
  state: BuildOnPushState,
): { pressed: string[] } {
  const pressed: string[] = [];
  render(
    <CommitRefusedNotice
      refused={refused(during)}
      state={state}
      onBuildOn={() => pressed.push("build on")}
      onAgain={() => pressed.push("again")}
      onRebuild={() => pressed.push("rebuild")}
      onAskAssistant={() => pressed.push("ask")}
      onDismiss={() => pressed.push("dismiss")}
    />,
  );
  return { pressed };
}

const buttons = () =>
  screen.getAllByRole("button").map((button) => button.textContent?.trim());

test("refused: who pushed and when, their commit, and Build on their push -- no Try again", () => {
  const { pressed } = shown("commit", { kind: "idle" });
  expect(
    screen.getByText(
      "Ada Lovelace pushed to val/p/0123456789abcdef0123 5 minutes ago",
    ),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: /Open their commit/ })
      .getAttribute("href"),
  ).toBe("https://github.com/acme/site/commit/3c4d5e6");
  expect(buttons()).toEqual(["Build on their push", "Dismiss"]);
  fireEvent.click(screen.getByText("Build on their push"));
  expect(pressed).toEqual(["build on"]);
});

test("built: the files kept as the proposal's, and Commit again, which does not wait for the rebuild", () => {
  const { pressed } = shown("commit", {
    kind: "built",
    kept: ["content/home.val.ts"],
    notTaken: [".github/workflows/ci.yml"],
    rewritten: false,
    rebuild: { state: "running" },
  });
  expect(screen.getByText("content/home.val.ts")).toBeTruthy();
  expect(screen.getByText(".github/workflows/ci.yml")).toBeTruthy();
  expect(screen.getByText(/Rebuilding the preview/)).toBeTruthy();
  fireEvent.click(screen.getByText("Commit again"));
  expect(pressed).toEqual(["again"]);
});

test("built, for Publish: Publish waits for the rebuild, and a failed one offers Build again", () => {
  shown("publish", {
    kind: "built",
    kept: [],
    notTaken: [],
    rewritten: false,
    rebuild: { state: "running" },
  });
  expect(screen.queryByText("Publish again")).toBeNull();
  expect(screen.getByText(/Publish waits for it/)).toBeTruthy();
});

test("built, for Publish, with the rebuild failed: Build again, and not Publish", () => {
  const { pressed } = shown("publish", {
    kind: "built",
    kept: [],
    notTaken: [],
    rewritten: false,
    rebuild: { state: "failed", message: "Unexpected token", canRetry: true },
  });
  expect(screen.queryByText("Publish again")).toBeNull();
  fireEvent.click(screen.getByText("Build again"));
  expect(pressed).toEqual(["rebuild"]);
});

test("built, for Publish, once rebuilt: Publish again", () => {
  const { pressed } = shown("publish", {
    kind: "built",
    kept: [],
    notTaken: [],
    rewritten: false,
    rebuild: { state: "done" },
  });
  fireEvent.click(screen.getByText("Publish again"));
  expect(pressed).toEqual(["again"]);
});

test("failed: only what can help is offered", () => {
  shown("commit", {
    kind: "failed",
    message: "GitHub could not be reached.",
    offer: { kind: "retry" },
  });
  expect(buttons()).toEqual(["Try again", "Dismiss"]);
});

test("failed with nothing that can help: their commit, and nothing pretending to", () => {
  shown("commit", {
    kind: "failed",
    message: "Their push changes 1204 files.",
    offer: null,
  });
  expect(buttons()).toEqual(["Dismiss"]);
  expect(screen.getByRole("link", { name: /Open their commit/ })).toBeTruthy();
});

test("signed out: Sign in, back to this page", () => {
  shown("commit", {
    kind: "failed",
    message: "Your session has run out.",
    offer: { kind: "sign-in", url: "/api/val/authorize?redirect_to=here" },
  });
  expect(
    screen.getByRole("link", { name: /Sign in/ }).getAttribute("href"),
  ).toBe("/api/val/authorize?redirect_to=here");
});

test("not allowed: the owners by name, and an email to them -- not Sign in", () => {
  shown("commit", {
    kind: "failed",
    message:
      "You are not allowed to change this proposal, so their push was not brought in.",
    offer: {
      kind: "not-allowed",
      owners: [
        { name: "Grace Hopper", email: "grace@acme.example" },
        { name: "Alan Turing", email: "alan@acme.example" },
      ],
      projectUrl: "https://admin.val.build/acme/site",
    },
  });
  expect(
    screen.getByText(/The owners are Grace Hopper and Alan Turing\./),
  ).toBeTruthy();
  const email = screen.getByRole("link", { name: /Email the owners/ });
  expect(email.getAttribute("href")).toMatch(
    /^mailto:grace@acme\.example,alan@acme\.example\?subject=/,
  );
  expect(screen.queryByRole("link", { name: /Sign in/ })).toBe(null);
});

test("not allowed, and Val Build did not say who the owners are: the project's page, which does", () => {
  shown("commit", {
    kind: "failed",
    message: "You are not allowed to change this proposal.",
    offer: {
      kind: "not-allowed",
      owners: [],
      projectUrl: "https://admin.val.build/acme/site",
    },
  });
  expect(
    screen
      .getByRole("link", { name: /Open in Val Build/ })
      .getAttribute("href"),
  ).toBe("https://admin.val.build/acme/site");
});

test("their code does not build, and building again cannot help: the assistant, not only Dismiss", () => {
  const { pressed } = shown("publish", {
    kind: "built",
    kept: [],
    notTaken: [],
    rewritten: false,
    rebuild: {
      state: "failed",
      message: "src/routes/index.tsx: Unexpected token",
      canRetry: false,
    },
  });
  expect(screen.getByText(/Unexpected token/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Ask the assistant/ }));
  expect(pressed).toEqual(["ask"]);
  expect(buttons()).not.toContain("Build again");
});
