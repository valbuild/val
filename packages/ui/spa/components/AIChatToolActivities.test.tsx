/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolActivities, type ToolActivity } from "./AIChatToolActivities";

/**
 * The tool row is progress, not content, and two things about it are load
 * bearing.
 *
 * It COLLAPSES: a turn that calls six tools used to push its own answer off
 * the bottom of the panel, so the list is behind a disclosure and only the
 * summary is on screen by default.
 *
 * `ask_user_question` is the exception, and it is not a detail: the turn is
 * BLOCKED until the card is answered. Collapsing one leaves a session that has
 * visibly stopped with nothing on screen saying why, so questions render
 * outside the collapsible whatever else the turn did.
 */

const tool = (name: string, status: ToolActivity["status"]): ToolActivity => ({
  toolCallId: `tc-${name}`,
  name,
  status,
});

const QUESTION: ToolActivity = {
  toolCallId: "tc-question",
  name: "ask_user_question",
  status: "pending",
  questions: [
    {
      question: "Which page should I update?",
      options: [{ label: "Home" }, { label: "About" }],
    },
  ],
};

function renderRow(activities: ToolActivity[]) {
  return render(
    <ToolActivities
      activities={activities}
      onSubmitAnswers={() => {}}
      onCancel={() => {}}
    />,
  );
}

describe("ToolActivities", () => {
  it("collapses the calls to a summary and opens them on click", () => {
    renderRow([
      tool("get_all_schema", "complete"),
      tool("search_content", "complete"),
      tool("create_patch", "complete"),
    ]);

    const toggle = screen.getByRole("button", { name: /used 3 tools/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Reading schemas")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("Reading schemas")).not.toBeNull();
    expect(screen.queryByText("Searching")).not.toBeNull();
    expect(screen.queryByText("Updating content")).not.toBeNull();
  });

  it("names the running tool and shimmers while it runs", () => {
    renderRow([
      tool("get_all_schema", "complete"),
      tool("search_content", "pending"),
    ]);

    const label = screen.getByText("Searching…");
    expect(label.classList.contains("val-shimmer-text")).toBe(true);
  });

  it("stops shimmering once every call is done", () => {
    const { container } = renderRow([
      tool("get_all_schema", "complete"),
      tool("search_content", "complete"),
    ]);

    expect(container.querySelector(".val-shimmer-text")).toBeNull();
  });

  it("reports a failed call without being opened", () => {
    renderRow([tool("get_source", "complete"), tool("create_patch", "error")]);

    expect(screen.queryByText("1 failed")).not.toBeNull();
  });

  it("keeps a pending question outside the collapsible", () => {
    renderRow([tool("get_all_schema", "complete"), QUESTION]);

    // Collapsed - the tool list is hidden ...
    const toggle = screen.getByRole("button", { name: /reading schemas/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // ... but the question the turn is waiting on is not.
    expect(screen.queryByText("Please answer to continue")).not.toBeNull();
    expect(screen.queryByText("Which page should I update?")).not.toBeNull();
  });

  it("shows a question card even when it is the only activity", () => {
    const { container } = renderRow([QUESTION]);

    expect(container.querySelector("[aria-expanded]")).toBeNull();
    expect(screen.queryByText("Please answer to continue")).not.toBeNull();
  });

  it("falls back to the raw name for a tool it has no label for", () => {
    renderRow([tool("some_new_server_tool", "pending")]);

    expect(screen.queryByText("some_new_server_tool…")).not.toBeNull();
  });
});
