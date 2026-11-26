/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ChecksBar,
  ChecksBarView,
  describeFinding,
  type ChecksBarViewProps,
} from "./ChecksBar";
import { pageCheckNotShown, resetPageCheck } from "../proposals/pageCheck";

jest.mock("./ValProvider", () => ({
  useCurrentProposal: () => null,
}));

const IDLE: ChecksBarViewProps = {
  typecheck: { status: "idle" },
  lint: { status: "idle" },
  page: { status: "idle" },
  followUp: { status: "idle" },
  onFixIt: () => {},
  pageRetry: { status: "limited" },
  onRetryChecks: null,
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

test("a page check that could not finish offers Try again, and says when it runs when it cannot", () => {
  const run = jest.fn();
  const page = {
    status: "failed" as const,
    message: "The AI service did not finish the page check.",
    details: "529 overloaded_error",
  };
  const { rerender } = render(
    <ChecksBarView
      {...IDLE}
      page={page}
      pageRetry={{ status: "available", run }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(run).toHaveBeenCalledTimes(1);
  // What the service said is for support, under Details.
  expect(screen.getByText("Details")).toBeTruthy();
  expect(screen.getByText("529 overloaded_error")).toBeTruthy();

  rerender(
    <ChecksBarView {...IDLE} page={page} pageRetry={{ status: "limited" }} />,
  );
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(
    screen.getByText(/It runs again after your next message\./),
  ).toBeTruthy();

  rerender(
    <ChecksBarView
      {...IDLE}
      page={page}
      pageRetry={{ status: "no-preview" }}
    />,
  );
  expect(
    screen.getByText(/It runs again once the preview is open\./),
  ).toBeTruthy();
});

test("a typecheck that could not run offers Try again, unless it would fail again", () => {
  const retry = jest.fn();
  const typecheck = {
    status: "failed" as const,
    message: "The typecheck could not run.",
    details: "adept answered 503",
  };
  const { rerender } = render(
    <ChecksBarView {...IDLE} typecheck={typecheck} onRetryChecks={retry} />,
  );
  expect(screen.getByText("The typecheck could not run.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
  rerender(
    <ChecksBarView {...IDLE} typecheck={typecheck} onRetryChecks={null} />,
  );
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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

/**
 * Reported from a phone: once the checks failed, the assistant could not be
 * used -- what they found filled the space above the composer, and nothing
 * put it away.
 */
describe("putting the checks away", () => {
  const STOPPED: ChecksBarViewProps = {
    ...IDLE,
    typecheck: { status: "ok" },
    lint: { status: "ok" },
    page: { status: "problems", count: 1 },
    followUp: {
      status: "stopped",
      reason: "budget",
      attempts: 2,
      findings: [
        {
          key: "page_check",
          failing: true,
          value: {
            summary: "The buttons have no red border.",
            findings: [{ message: "a is 1.33px transparent", where: "a" }],
          },
        },
      ],
    },
  };

  test("the checks can be hidden, and stay hidden while they say the same", () => {
    const { container, rerender } = render(<ChecksBarView {...STOPPED} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide the checks" }));
    expect(container.innerHTML).toBe("");
    // The same checks again -- the bar re-renders as the chat does.
    rerender(<ChecksBarView {...STOPPED} followUp={{ ...STOPPED.followUp }} />);
    expect(container.innerHTML).toBe("");
  });

  test("hidden checks come back when they have something new to say", () => {
    const { rerender } = render(<ChecksBarView {...STOPPED} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide the checks" }));
    rerender(<ChecksBarView {...STOPPED} page={{ status: "running" }} />);
    expect(
      screen.getByRole("status", { name: "Checks of the change" }),
    ).toBeTruthy();
  });

  test("a check that could not run can be hidden too", () => {
    const { container } = render(
      <ChecksBarView
        {...IDLE}
        page={{ status: "failed", message: "The page check was stopped." }}
        pageRetry={{ status: "available", run: () => {} }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide the checks" }));
    expect(container.innerHTML).toBe("");
  });
});

describe("a page the change is not on yet", () => {
  const NAME = "0123456789abcdef0123";
  const INPUTS = "a".repeat(64);
  beforeEach(() => resetPageCheck());

  function bar() {
    return render(
      <ChecksBar
        proposalName={NAME}
        onFixIt={() => {}}
        retryPageCheck={() => {}}
        pageCheckCanRun={() => "yes"}
        retryChecks={() => {}}
      />,
    );
  }

  test("says it was not checked and why, with no Try again that would only say it again", () => {
    pageCheckNotShown(NAME, INPUTS, {
      reason: "failed",
      message: "The page with the quick preview did not load.",
    });
    bar();
    expect(
      screen.getByText(
        /The page was not checked: the change could not be shown in a quick preview/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a quick preview that was slow to come can be checked again", () => {
    pageCheckNotShown(NAME, INPUTS, { reason: "timeout", waitedMs: 120_000 });
    bar();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
