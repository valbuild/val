/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { CodeModeStatus } from "./CodeModeStatus";

describe("the preview's status, as an icon", () => {
  test("shows no words, and says what it is in its label", () => {
    render(
      <CodeModeStatus build={{ state: "up-to-date" }} onReload={() => {}} />,
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe(
      "Reload the preview. The preview is up to date.",
    );
  });

  test("a build with a percent draws a ring and names its step", () => {
    const { container } = render(
      <CodeModeStatus
        build={{ state: "updating", progress: 0.42, step: "Building the site" }}
        onReload={() => {}}
      />,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Reload the preview. Updating the preview: 42%. Building the site.",
    );
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  test("a build without a percent turns, and draws no ring", () => {
    const { container } = render(
      <CodeModeStatus
        build={{ state: "updating", progress: null }}
        onReload={() => {}}
      />,
    );
    expect(container.querySelector("circle")).toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  test("pressed, it reloads the preview", () => {
    const onReload = jest.fn();
    render(<CodeModeStatus build={{ state: "behind" }} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
