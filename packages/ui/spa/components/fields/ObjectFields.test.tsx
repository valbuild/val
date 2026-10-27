/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";
import { initVal, SerializedSchema, SourcePath } from "@valbuild/core";

/**
 * What an object field draws when its source is `null`.
 *
 * A `null` value has no children, so rendering the schema's items over one
 * asks the store for paths that do not exist and gets "Not Found" for every
 * single field — a wall of broken children where the truth is one fact about
 * the parent. The case that made this visible is a locale-keyed record, whose
 * unwritten entries ARE `null` (see `core/src/schema/declaredKeys.ts`), and
 * whose entry page renders through here with no `Field` wrapper to catch it.
 *
 * Nothing in this file is about declared keys, and that is the point: the rule
 * being pinned is "do not render children of a null source", which holds for a
 * `.nullable()` object just as well.
 */
const mockSchemaAt = jest.fn();
const mockSource = jest.fn();
const mockAddPatch = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useSchemaAtPath: (path: SourcePath) => mockSchemaAt(path),
  useShallowSourceAtPath: () => mockSource(),
  useAddPatch: () => ({ patchPath: [], addPatch: mockAddPatch }),
}));

// The children, marked rather than rendered: the claim is whether any child is
// drawn at all, and the real ones drag in the whole field tree.
jest.mock("../../components/AnyField", () => ({
  __esModule: true,
  AnyField: () => <div data-testid="any-field" />,
}));
jest.mock("../../components/Field", () => ({
  __esModule: true,
  Field: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="field">{children}</div>
  ),
}));
jest.mock("../../components/FieldNotFound", () => ({
  __esModule: true,
  FieldNotFound: () => <div data-testid="field-not-found" />,
}));
// Only the preview path needs this, and reaching it pulls `RouteField` in and
// with it `ValProvider` — an ESM module jest cannot require.
jest.mock("../../components/Preview", () => ({
  __esModule: true,
  Preview: () => <div data-testid="preview" />,
}));

import { ObjectFields } from "./ObjectFields";

const { s } = initVal();
const itemSchema = s.object({ title: s.string(), body: s.string() });

const RECORD_PATH = '/content/translated.val.ts?p="announcements"';
const ENTRY_PATH = `${RECORD_PATH}."nb-NO"` as SourcePath;

/**
 * Mount the entry at {@link ENTRY_PATH} with the given source, inside a record
 * keyed by `key`.
 */
function mount(
  source: null | Record<string, SourcePath>,
  key: SerializedSchema | undefined,
) {
  const entrySchema = itemSchema["executeSerialize"]();
  const recordSchema: SerializedSchema = {
    type: "record",
    item: entrySchema,
    key,
    opt: false,
  };
  mockSchemaAt.mockImplementation((path: SourcePath) => ({
    status: "success",
    data: path === ENTRY_PATH ? entrySchema : recordSchema,
  }));
  mockSource.mockReturnValue({ status: "success", data: source });
}

const localeKey = s.locale()["executeSerialize"]();
const stringKey = s.string()["executeSerialize"]();

describe("ObjectFields on a null source", () => {
  beforeEach(() => {
    mockAddPatch.mockClear();
  });

  test("draws one create button, and none of the schema's children", () => {
    mount(null, stringKey);
    render(<ObjectFields path={ENTRY_PATH} />);
    expect(screen.queryAllByTestId("field")).toHaveLength(0);
    expect(screen.queryAllByTestId("any-field")).toHaveLength(0);
    expect(screen.queryByTestId("field-not-found")).toBeNull();
    expect(screen.queryByRole("button", { name: /^create$/i })).not.toBeNull();
  });

  test("an entry of a locale-keyed record offers to translate it", () => {
    mount(null, localeKey);
    render(<ObjectFields path={ENTRY_PATH} />);
    expect(screen.queryAllByTestId("any-field")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /write this translation/i }),
    ).not.toBeNull();
  });

  test("creating writes the item's empty value, not null", () => {
    mount(null, localeKey);
    render(<ObjectFields path={ENTRY_PATH} />);
    screen.getByRole("button").click();
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: [], value: { title: "", body: "" } }],
      "object",
    );
  });

  test("readonly cannot create it", () => {
    // Disabled rather than absent: a readonly null still has to say what it
    // is, and an empty pane says nothing at all.
    mount(null, localeKey);
    render(<ObjectFields path={ENTRY_PATH} readonly />);
    const button = screen.getByRole("button");
    expect(button).toHaveProperty("disabled", true);
    button.click();
    expect(mockAddPatch).not.toHaveBeenCalled();
  });

  test("a written entry still draws its children", () => {
    mount(
      {
        title: `${ENTRY_PATH}."title"` as SourcePath,
        body: `${ENTRY_PATH}."body"` as SourcePath,
      },
      localeKey,
    );
    render(<ObjectFields path={ENTRY_PATH} />);
    expect(screen.queryAllByTestId("any-field")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
