/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ColumnDivider } from "./ColumnDivider";

/**
 * A column's edge, from the keyboard: the arrows move it, away from the
 * column is wider, it stops at its limits, and a double-click puts the
 * column back.
 */
function Column({ edge }: { edge: "left" | "right" }) {
  const [width, setWidth] = useState<number | null>(null);
  return (
    <ColumnDivider
      label="Resize"
      edge={edge}
      width={width ?? 400}
      min={340}
      max={440}
      onResize={setWidth}
      onReset={() => setWidth(null)}
    />
  );
}

const value = () =>
  screen
    .getByRole("separator", { name: "Resize" })
    .getAttribute("aria-valuenow");

test("a right edge: ArrowRight widens, and stops at the most it can be", () => {
  render(<Column edge="right" />);
  const handle = screen.getByRole("separator", { name: "Resize" });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(value()).toBe("424");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(value()).toBe("440");
  fireEvent.doubleClick(handle);
  expect(value()).toBe("400");
});

test("a left edge: ArrowLeft widens, ArrowRight narrows to the least it can be", () => {
  render(<Column edge="left" />);
  const handle = screen.getByRole("separator", { name: "Resize" });
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(value()).toBe("424");
  for (let i = 0; i < 5; i++) fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(value()).toBe("340");
  expect(handle.getAttribute("aria-valuemin")).toBe("340");
  expect(handle.getAttribute("aria-valuemax")).toBe("440");
});
