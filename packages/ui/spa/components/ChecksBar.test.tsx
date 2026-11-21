/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ChecksBarView,
  describeFinding,
  type ChecksBarViewProps,
} from "./ChecksBar";

jest.mock("./ValProvider", () => ({
  useCurrentProposal: () => null,
}));

const IDLE: ChecksBarViewProps = {
  typecheck: { status: "idle" },
  lint: { status: "idle" },
  page: { status: "idle" },
  followUp: { status: "idle" },
  onFixIt: () => {},
  onRetryPageCheck: null,
};

test("nothing checked, nothing shown", () => {
  const { container } = render(<ChecksBarView {...IDLE} />);
  expect(container.innerHTML).toBe("");
});

test("each check in a word, while the person goes on", () => {
  render(
    <ChecksBarView
      {...IDLE}
      typecheck={{ status: "ok" }}
      lint={{ status: "problems", count: 2 }}
      page={{ status: "running" }}
      followUp={{ status: "fixing", attempt: 1, of: 2 }}
    />,
  );
  const bar = screen.getByRole("status", { name: "Checks of the change" });
  expect(bar.textContent).toContain("Types");
  expect(bar.textContent).toContain("Lint2 problems");
  expect(bar.textContent).toContain("Fixing what they found (1 of 2)");
});

test("when the follow-ups stop, what is wrong is listed, and Fix it asks for it", () => {
  const onFixIt = jest.fn();
  render(
    <ChecksBarView
      {...IDLE}
      followUp={{
        status: "stopped",
        reason: "budget",
        attempts: 2,
        findings: [
          {
            key: "typecheck_errors",
            failing: true,
            value: {
              errors: [
                { file: "src/Hero.tsx", line: 3, message: "Type 'number'…" },
              ],
            },
          },
        ],
      }}
      onFixIt={onFixIt}
    />,
  );
  expect(
    screen.getByText("The checks still find problems after 2 automatic fixes."),
  ).toBeTruthy();
  expect(screen.getByText("src/Hero.tsx:3 Type 'number'…")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Fix it" }));
  expect(onFixIt).toHaveBeenCalledTimes(1);
});

test("a fix that changed nothing says so", () => {
  render(
    <ChecksBarView
      {...IDLE}
      followUp={{
        status: "stopped",
        reason: "no-progress",
        attempts: 1,
        findings: [],
      }}
    />,
  );
  expect(
    screen.getByText(
      "The assistant's last fix did not change what the checks find.",
    ),
  ).toBeTruthy();
});

test("a page check that could not finish offers Try again, and says when it runs when none is left", () => {
  const retry = jest.fn();
  const { rerender } = render(
    <ChecksBarView
      {...IDLE}
      page={{ status: "failed", message: "The AI service did not answer." }}
      onRetryPageCheck={retry}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);

  rerender(
    <ChecksBarView
      {...IDLE}
      page={{ status: "failed", message: "The AI service did not answer." }}
      onRetryPageCheck={null}
    />,
  );
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(
    screen.getByText(/It runs again after your next message\./),
  ).toBeTruthy();
});

test("a failed page check reads as what was seen, and where", () => {
  expect(
    describeFinding({
      key: "page_check",
      failing: true,
      value: {
        summary: "The heading is the old colour.",
        findings: [{ message: "h1 is black", where: "main h1" }],
      },
    }),
  ).toEqual([
    "On the page: The heading is the old colour.",
    "h1 is black (main h1)",
  ]);
});
