/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { initVal, SerializedSchema, SourcePath } from "@valbuild/core";

/**
 * Turning a nullable media field off again.
 *
 * `s.image(gallery).nullable()` could be filled in but not emptied. The tick
 * box that offers a nullable field its two states has a THIRD one for media —
 * source `null` with the field shown, which is what "on" means before anything
 * has been uploaded, because a media value with no file is not writable — and
 * the handler branched on `source === null`, which cannot tell that state from
 * "off". So the second click ran the turn-on branch again: the box stayed
 * ticked, and an image, once added, could be replaced but never removed.
 *
 * What is pinned here is the click sequence an editor actually performs, in
 * both orders: a field that starts empty and one that starts with a file.
 */
const mockSchemaAt = jest.fn();
const mockSource = jest.fn();
const mockAddPatch = jest.fn();

jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useSchemaAtPath: (path: SourcePath) => mockSchemaAt(path),
  useShallowSourceAtPath: () => mockSource(),
  useAddPatch: () => ({ patchPath: ["cover"], addPatch: mockAddPatch }),
  useGetNavPath: () => () => undefined,
}));
jest.mock("./ValErrorProvider", () => ({
  __esModule: true,
  useValidationErrors: () => [],
}));
// The chrome around the tick box, none of which is what this file is about —
// and all of which reaches for a store the moment it is rendered.
jest.mock("./ArrayAndRecordTools", () => ({
  __esModule: true,
  ArrayAndRecordTools: () => null,
}));
jest.mock("./FieldPatchAuthorsSection", () => ({
  __esModule: true,
  FieldPatchAuthorsSection: () => null,
}));
jest.mock("./AIChatActionsContext", () => ({
  __esModule: true,
  useAIChatActions: () => ({ canMentionField: false }),
  useInsertFieldRef: () => () => {},
}));
jest.mock("./ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: () => {} }),
}));
jest.mock("../history/RestoreChrome", () => ({
  __esModule: true,
  RestoreChrome: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
// Not a boolean field in any of these cases — and importing the real one pulls
// in `Preview`, and with it the whole field tree and `ValProvider`.
jest.mock("./fields/BooleanField", () => ({
  __esModule: true,
  EmbeddedBooleanField: () => null,
}));
jest.mock("../hooks/useEmptyOf", () => ({
  __esModule: true,
  useEmptyOf: () => () => null,
}));

import { Field } from "./Field";

const { s } = initVal();
const PATH = '/content/page.val.ts?p="cover"' as SourcePath;

type Source = { path: string } | null;

function mount(initial: Source, schema: SerializedSchema) {
  let current = initial;
  mockSchemaAt.mockImplementation(() => ({ status: "success", data: schema }));
  mockSource.mockImplementation(() => ({
    status: "success",
    data: current,
    clientSideOnly: false,
  }));
  const view = render(
    <Field path={PATH} type={schema.type}>
      <div data-testid="image-field" />
    </Field>,
  );
  return {
    ...view,
    /** What a write would do: the store answers with the new source next time. */
    setSource: (next: Source) => {
      current = next;
      view.rerender(
        <Field path={PATH} type={schema.type}>
          <div data-testid="image-field" />
        </Field>,
      );
    },
  };
}

const nullableImage: SerializedSchema = {
  ...s.image().nullable()["executeSerialize"](),
};

describe("the nullable tick box on a media field", () => {
  beforeEach(() => {
    mockAddPatch.mockReset();
  });

  test("clears an image that was added in the same visit", () => {
    const { setSource } = mount(null, nullableImage);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");

    // On: the field opens so there is something to upload into. No patch —
    // there is no file yet, and a media source without one is not valid.
    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(mockAddPatch).not.toHaveBeenCalled();

    // The upload lands.
    setSource({ path: "/public/val/cover_a1b2c.jpg" });
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true",
    );

    // Off: this is the click that did nothing.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: ["cover"], value: null }],
      "image",
    );
    setSource(null);
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  test("clears an image that was already there", () => {
    const { setSource } = mount(
      { path: "/public/val/cover_a1b2c.jpg" },
      nullableImage,
    );
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(checkbox);
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: ["cover"], value: null }],
      "image",
    );
    setSource(null);
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  test("turning it off and on again does not leave a stale patch", () => {
    const { setSource } = mount(
      { path: "/public/val/cover_a1b2c.jpg" },
      nullableImage,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    setSource(null);
    mockAddPatch.mockReset();

    // Back on: the field opens again, empty, and still writes nothing until a
    // file arrives.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(mockAddPatch).not.toHaveBeenCalled();
  });
});
