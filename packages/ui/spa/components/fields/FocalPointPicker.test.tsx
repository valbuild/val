/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { FocalPointPicker } from "./FocalPointPicker";

/**
 * The focal point can be set without a pointer.
 *
 * The picker was a `<div>` that only answered clicks and drags, so a keyboard
 * or a screen reader could neither find the point nor move it. The marker is a
 * button now: it says where it is, and the arrow keys move it.
 */
function marker() {
  return screen.getByRole("button", { name: /Point to keep in frame/ });
}

test("says where the point is", () => {
  render(
    <FocalPointPicker
      url="/val/a.jpg"
      hotspot={{ x: 0.7, y: 0.25 }}
      onChange={jest.fn()}
    />,
  );
  expect(marker().getAttribute("aria-label")).toContain(
    "70% across and 25% down",
  );
});

test("moves by 1% per arrow press, and 10% with Shift", () => {
  const onChange = jest.fn();
  render(
    <FocalPointPicker
      url="/val/a.jpg"
      hotspot={{ x: 0.7, y: 0.25 }}
      onChange={onChange}
    />,
  );
  fireEvent.keyDown(marker(), { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith({ x: 0.71, y: 0.25 });
  fireEvent.keyDown(marker(), { key: "ArrowDown", shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith({ x: 0.7, y: 0.35 });
});

test("an unset point starts from the middle, and stops at the edge", () => {
  const onChange = jest.fn();
  render(
    <FocalPointPicker
      url="/val/a.jpg"
      hotspot={undefined}
      onChange={onChange}
    />,
  );
  expect(marker().getAttribute("aria-label")).toContain("not set");
  fireEvent.keyDown(marker(), { key: "ArrowLeft" });
  expect(onChange).toHaveBeenLastCalledWith({ x: 0.49, y: 0.5 });
  onChange.mockClear();
  render(
    <FocalPointPicker
      url="/val/b.jpg"
      hotspot={{ x: 1, y: 0 }}
      onChange={onChange}
    />,
  );
  fireEvent.keyDown(
    screen.getAllByRole("button", { name: /Point to keep in frame/ })[1],
    {
      key: "ArrowRight",
    },
  );
  expect(onChange).toHaveBeenLastCalledWith({ x: 1, y: 0 });
});

test("cannot be moved when read-only", () => {
  render(
    <FocalPointPicker
      url="/val/a.jpg"
      hotspot={{ x: 0.5, y: 0.5 }}
      readonly
      onChange={jest.fn()}
    />,
  );
  expect(marker().hasAttribute("disabled")).toBe(true);
});
