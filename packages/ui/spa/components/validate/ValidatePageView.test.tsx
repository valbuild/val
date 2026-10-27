/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import {
  ValidatePageView,
  type FailureAction,
  type FullCheckState,
  type ValidateGroup,
} from "./ValidatePageView";

const noop = () => {};

function view(
  groups: ValidateGroup[],
  fullCheck: FullCheckState,
  onCheckEverything: (() => void) | null = noop,
) {
  return render(
    <ValidatePageView
      groups={groups}
      fullCheck={fullCheck}
      onCheckEverything={onCheckEverything}
      onStop={noop}
      onFixEverything={noop}
      onFixGroup={noop}
      onRowAction={noop}
    />,
  );
}

const failedFix = (action: FailureAction): ValidateGroup[] => [
  {
    id: "/content/media.val.ts",
    title: "content / media.val.ts",
    rows: [
      {
        id: "a",
        location: "/public/val/hero_3fa9c.jpg",
        message: "No width, height or type recorded.",
        tone: "fixable",
        action: { kind: "fix" },
        fixState: { status: "failed", message: "It failed.", action },
      },
    ],
  },
];

/**
 * An error offers what can be done about it, and nothing that cannot help
 * (`.claude/CLAUDE.md`, "An error says what the person can do about it").
 */
describe("what a failure offers", () => {
  test("a session that ended offers Sign in, back to this page", () => {
    view(failedFix("sign-in"), { status: "done", checkedAgo: "now" });
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toContain("/api/val/authorize");
    expect(link.getAttribute("href")).toContain(
      encodeURIComponent(window.location.href),
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a refusal that would answer the same offers nothing to press", () => {
    view(failedFix("none"), { status: "done", checkedAgo: "now" });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  test("a server that could not be reached offers Try again", () => {
    view(failedFix("try-again"), { status: "done", checkedAgo: "now" });
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("a check stopped by an ended session offers Sign in, not Try again", () => {
    view([], {
      status: "failed",
      message: "Your session has ended, so the check stopped.",
      action: "sign-in",
    });
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

/*
 * The check walks the modules the Studio's schemas name, so before they have
 * loaded a press would check nothing -- and it used to, without a word, which
 * on a slow dev server read as a button that does not work.
 */
describe("before the Studio has the project's schemas", () => {
  test("Check everything cannot be pressed", () => {
    view([], { status: "not-run" }, null);
    const button = screen.getByRole("button", { name: "Check everything" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  test("and can be once they are there", () => {
    view([], { status: "not-run" });
    const button = screen.getByRole("button", { name: "Check everything" });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
