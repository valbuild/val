/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { initVal, SourcePath } from "@valbuild/core";
import { FIELD_WRITE_DEBOUNCE_MS } from "./useDebouncedFieldWrite";

const mockSchema = jest.fn();
const mockSource = jest.fn();
/** One spy, shared by every render, so writes are observable. */
const mockAddPatch = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useSchemaAtPath: () => mockSchema(),
  useShallowSourceAtPath: () => mockSource(),
  useAddPatch: () => ({ patchPath: [], addPatch: mockAddPatch }),
}));

jest.mock("../../components/Preview", () => ({
  __esModule: true,
  PreviewLoading: () => <div data-testid="preview-loading" />,
  PreviewNull: () => <div data-testid="preview-null" />,
}));

import { NumberField } from "./NumberField";
import { NumberSliderPure } from "./NumberSlider";

const { s } = initVal();
const PATH = '/content/page.val.ts?p="opacity"' as SourcePath;

function mount(
  schema: ReturnType<typeof s.int>,
  source: number | null,
): ReturnType<typeof render> {
  mockSchema.mockReturnValue({
    status: "success",
    data: schema["executeSerialize"](),
  });
  mockSource.mockReturnValue({ status: "success", data: source });
  return render(<NumberField path={PATH} />);
}

const slider = () => screen.getByRole("slider");
const box = () => screen.getByRole("textbox", { name: "Value" });

beforeEach(() => {
  mockAddPatch.mockReset();
});

describe("NumberField", () => {
  test("a plain int is a text box, not a slider", () => {
    mount(s.int(), 3);
    expect(screen.queryByRole("slider")).toBe(null);
    expect(screen.getByRole("textbox")).toHaveProperty("value", "3");
  });

  test("render({ as: 'slider' }) is a slider with the render's range", () => {
    mount(s.int().render({ as: "slider", min: 0, max: 100, step: 5 }), 40);
    expect(slider()).toHaveProperty("min", "0");
    expect(slider()).toHaveProperty("max", "100");
    expect(slider()).toHaveProperty("step", "5");
    expect(slider()).toHaveProperty("value", "40");
    expect(box()).toHaveProperty("value", "40");
  });

  test("the slider steps in the schema's step when the render has none", () => {
    mount(
      s.int().min(0).step(10).render({ as: "slider", min: 0, max: 100 }),
      40,
    );
    expect(slider()).toHaveProperty("step", "10");
  });

  test("a drag is one patch, written after a pause", () => {
    jest.useFakeTimers();
    try {
      mount(s.int().render({ as: "slider", min: 0, max: 100 }), 40);
      for (const value of ["41", "45", "52", "60"]) {
        fireEvent.change(slider(), { target: { value } });
      }
      // The thumb and the box follow at once…
      expect(box()).toHaveProperty("value", "60");
      // …the patch does not.
      expect(mockAddPatch).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(FIELD_WRITE_DEBOUNCE_MS);
      });
      expect(mockAddPatch).toHaveBeenCalledTimes(1);
      expect(mockAddPatch).toHaveBeenCalledWith(
        [{ op: "replace", path: [], value: 60 }],
        "number",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test("letting go writes at once", () => {
    mount(s.int().render({ as: "slider", min: 0, max: 100 }), 40);
    fireEvent.change(slider(), { target: { value: "70" } });
    fireEvent.pointerUp(slider());
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: [], value: 70 }],
      "number",
    );
  });

  test("a plain int off its step offers to round it", () => {
    mount(s.int().min(0).step(5), 42);
    fireEvent.click(screen.getByRole("button", { name: "Round to 40" }));
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: [], value: 40 }],
      "number",
    );
  });

  test("a plain int out of bounds offers the bound", () => {
    mount(s.int().max(10), 12);
    expect(screen.getByRole("button", { name: "Set to 10" })).toBeTruthy();
  });

  test("an allowed value offers nothing", () => {
    mount(s.int().min(0).step(5), 40);
    expect(screen.queryByRole("button")).toBe(null);
  });
});

describe("NumberSliderPure", () => {
  test("a value outside the slider says so and offers the nearest end", () => {
    const onChange = jest.fn();
    render(
      <NumberSliderPure
        value={150}
        render={{ as: "slider", min: 0, max: 100 }}
        rules={{ integer: true }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "150 is above this slider's range (0–100).",
    );
    // The box still shows the real value; only the thumb is pinned.
    expect(box()).toHaveProperty("value", "150");
    fireEvent.click(screen.getByRole("button", { name: "Set to 100" }));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  test("the offered value is a stop of the slider", () => {
    const onChange = jest.fn();
    render(
      <NumberSliderPure
        value={-7}
        render={{ as: "slider", min: 1, max: 9, step: 4 }}
        rules={{ integer: true, min: -100, step: 2 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set to 1" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  test("a value between the schema's steps offers to round it", () => {
    const onChange = jest.fn();
    render(
      <NumberSliderPure
        value={42}
        render={{ as: "slider", min: 0, max: 100 }}
        rules={{ integer: true, min: 0, step: 5 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Round to 40" }));
    expect(onChange).toHaveBeenCalledWith(40);
  });

  test("typing an exact value", () => {
    const onChange = jest.fn();
    render(
      <NumberSliderPure
        value={40}
        render={{ as: "slider", min: 0, max: 100 }}
        rules={{ integer: true }}
        onChange={onChange}
      />,
    );
    fireEvent.focus(box());
    // A half-typed number is not a number, and is not written…
    fireEvent.change(box(), { target: { value: "-" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(box()).toHaveProperty("value", "-");
    // …a whole one is.
    fireEvent.change(box(), { target: { value: "-5" } });
    expect(onChange).toHaveBeenCalledWith(-5);
  });

  test("few stops are labelled, many are not", () => {
    const { rerender } = render(
      <NumberSliderPure
        value={4}
        render={{ as: "slider", min: 1, max: 5 }}
        rules={{ integer: true }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("3")).toBeTruthy();
    rerender(
      <NumberSliderPure
        value={40}
        render={{ as: "slider", min: 0, max: 100 }}
        rules={{ integer: true }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText("50")).toBe(null);
    expect(screen.getByText("100")).toBeTruthy();
  });
});
