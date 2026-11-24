/** @jest-environment jsdom */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CanvasSelectMode } from "../../hooks/selectModePreference";
import {
  readSelectModePreference,
  writeSelectModePreference,
} from "../../hooks/selectModePreference";
import { SelectButton } from "./SelectButton";

/** Content's Select, with its state held as the workspace holds it. */
function Harness({
  initialMode = "select",
  unavailable,
}: {
  initialMode?: CanvasSelectMode;
  unavailable?: string;
}) {
  const [pressed, setPressed] = useState(false);
  const [mode, setMode] = useState<CanvasSelectMode>(initialMode);
  return (
    <SelectButton
      selectFor="content"
      pressed={pressed}
      onPressedChange={setPressed}
      mode={mode}
      onModeChange={setMode}
      unavailable={unavailable}
    />
  );
}

const openMenu = () =>
  fireEvent.click(
    screen.getByRole("button", {
      name: "Choose what selecting on the page does",
    }),
  );

describe("Content's Select and its two modes", () => {
  test("starts as Select, and is turned on and off as it always was", () => {
    render(<Harness />);
    const select = screen.getByRole("button", { name: "Select on the page" });
    expect(select.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(select);
    expect(
      screen
        .getByRole("button", { name: "Stop selecting on the page" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("the menu offers both, and says which one it is", () => {
    render(<Harness />);
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
    expect(items[0].textContent).toContain("Select & edit");
    expect(items[1].textContent).toContain("Select");
  });

  test("choosing Select & edit changes what the button is, and turns it on", () => {
    render(<Harness />);
    openMenu();
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Select & edit/ }),
    );
    // Choosing how to select is asking to select that way.
    const button = screen.getByRole("button", {
      name: "Stop selecting and editing on the page",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe("Select & edit");
    expect(screen.queryByRole("menu")).toBeNull();
    // And off again is one press, in the same mode.
    fireEvent.click(button);
    expect(
      screen
        .getByRole("button", { name: "Select and edit on the page" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  test("a mode can be chosen before there is anything to select, without turning it on", () => {
    render(<Harness unavailable="Nothing on the page can be selected yet" />);
    openMenu();
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Select & edit/ }),
    );
    const button = screen.getByRole("button", {
      name: "Select and edit on the page",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button).toHaveProperty("disabled", true);
  });

  test("Esc closes the menu, and is not also the Esc that turns Select off", () => {
    render(<Harness initialMode="edit" />);
    const heard = jest.fn();
    window.addEventListener("keydown", heard);
    openMenu();
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", heard);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  test("without a way to change the mode it is the one button it was", () => {
    render(
      <SelectButton
        selectFor="content"
        pressed={false}
        onPressedChange={() => undefined}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button").textContent).toBe("Select");
  });

  test("the Assistant's has no modes", () => {
    render(
      <SelectButton
        selectFor="assistant"
        pressed={false}
        onPressedChange={() => undefined}
        mode="edit"
        onModeChange={() => undefined}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button").textContent).toBe("Select");
  });
});

describe("the mode a person used last", () => {
  afterEach(() => localStorage.clear());

  test("is Select until they choose otherwise", () => {
    expect(readSelectModePreference()).toBe("select");
  });

  test("is kept, and anything else in its place is read as Select", () => {
    writeSelectModePreference("edit");
    expect(readSelectModePreference()).toBe("edit");
    writeSelectModePreference("select");
    expect(readSelectModePreference()).toBe("select");
    localStorage.setItem("val:canvas:select-mode", "something else");
    expect(readSelectModePreference()).toBe("select");
  });
});
