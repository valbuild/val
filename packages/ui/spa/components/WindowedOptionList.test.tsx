/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { WindowedOptionList, type WindowedOption } from "./WindowedOptionList";

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const OPTIONS: WindowedOption[] = ["alpha", "bravo", "charlie"].map((key) => ({
  key,
  filterText: key,
}));

function list(props: {
  options: WindowedOption[];
  isLoading?: boolean;
  onSelect?: (option: WindowedOption) => void;
}) {
  return (
    <WindowedOptionList
      options={props.options}
      isLoading={props.isLoading ?? false}
      renderOption={(option) => option.key}
      onSelect={props.onSelect ?? (() => {})}
      selectedKey="charlie"
      search=""
      onSearchChange={() => {}}
      placeholder="Search"
      emptyText="Nothing"
    />
  );
}

const active = () =>
  screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true")
    ?.textContent;

test("the Enter that ends an IME composition does not pick an option", () => {
  const picked: string[] = [];
  render(list({ options: OPTIONS, onSelect: (o) => picked.push(o.key) }));
  const input = screen.getByRole("combobox");

  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  // Safari: the composition's Enter is only key code 229.
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(picked).toEqual([]);

  fireEvent.keyDown(input, { key: "Enter" });
  expect(picked).toEqual(["charlie"]);
});

test("a list opened while its options load is put at the value when they arrive", () => {
  const { rerender } = render(list({ options: [], isLoading: true }));
  expect(screen.queryAllByRole("option")).toEqual([]);

  rerender(list({ options: OPTIONS }));

  expect(active()).toBe("charlie");
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
});

test("options arriving after the editor has moved do not move them back", () => {
  const { rerender } = render(list({ options: OPTIONS.slice(0, 2) }));
  // The value is not among them yet: the first is active, and they move.
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  expect(active()).toBe("bravo");

  rerender(list({ options: OPTIONS }));

  expect(active()).toBe("bravo");
});

test("the search is 16px on a touch screen, where iOS zooms into anything smaller", () => {
  render(list({ options: OPTIONS }));
  expect(screen.getByRole("combobox").className).toContain("touch:text-base");
});
