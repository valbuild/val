/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { act, render, screen } from "@testing-library/react";
import { initVal, Schema, SelectorSource, SourcePath } from "@valbuild/core";

/**
 * WHICH LAYOUT a record field draws: its entries in place, or a list of rows
 * you click into. The record counterpart of `ArrayFields.test.tsx`, and here
 * for the same reason: `isInlineRender` is pinned in
 * `core/src/schema/render.test.ts`, but a `RecordFields` that asked the ITEM
 * instead of the record would pass every test there and still draw preview
 * rows for a record that declared itself inline. That seam is this file.
 *
 * Both lists are stubbed to markers and each in-place entry is the stubbed
 * `AnyField`, so the claim is the choice and nothing about how either looks.
 */
const mockSchema = jest.fn();
const mockSource = jest.fn();
const mockPreview = jest.fn((): unknown => undefined);
const mockListMounts = { count: 0 };

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  usePreviewAtPath: () => mockPreview(),
  useSchemaAtPath: () => mockSchema(),
  useShallowSourceAtPath: () => mockSource(),
  useSourceAtPath: () => ({ status: "success", data: {} }),
}));

jest.mock("./VirtualizedRecordList", () => ({
  __esModule: true,
  VirtualizedRecordList: function MockVirtualizedRecordList() {
    // Counts mounts: a new list is a new scroll viewport, back at the top.
    jest.requireActual("react").useEffect(() => {
      mockListMounts.count++;
    }, []);
    return <div data-testid="record-list" />;
  },
  RecordRowSkeleton: () => null,
  RecordRowError: () => null,
}));

jest.mock("../../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => ({}),
}));

jest.mock("../ValErrorProvider", () => ({
  __esModule: true,
  useAllValidationErrors: () => ({}),
}));

jest.mock("../LocaleFilterProvider", () => ({
  __esModule: true,
  useLocaleFilterPredicate: () => () => true,
  LocaleFiltered: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("../../components/ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
}));

// The generic dispatchers, which would otherwise drag in the whole field tree
// (and, through `ValProvider`, a worker URL jest cannot parse).
jest.mock("../../components/AnyField", () => ({
  __esModule: true,
  AnyField: () => <div data-testid="any-field" />,
}));
jest.mock("../../components/Field", () => ({
  __esModule: true,
  Field: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../../components/BlockList", () => ({
  __esModule: true,
  BlockList: () => <div data-testid="block-list" />,
}));
jest.mock("./ModuleGallery", () => ({
  __esModule: true,
  ModuleGallery: () => <div data-testid="module-gallery" />,
}));
jest.mock("../../components/FieldNull", () => ({
  __esModule: true,
  FieldNull: () => <div data-testid="field-null" />,
}));
jest.mock("../../components/RefPreview", () => ({
  __esModule: true,
  RefPreview: () => null,
}));
jest.mock("../../components/Preview", () => ({
  __esModule: true,
  PreviewLoading: () => null,
  PreviewNull: () => null,
}));
jest.mock("../PreviewError", () => ({
  __esModule: true,
  PreviewError: () => null,
}));

import { RecordFields } from "./RecordFields";

const { s } = initVal();
const PATH = '/content/page.val.ts?p="authors"' as SourcePath;

/** Mount `record`, holding two entries. */
function mount(record: Schema<SelectorSource>) {
  mockSchema.mockReturnValue({
    status: "success",
    data: record["executeSerialize"](),
  });
  mockSource.mockReturnValue({
    status: "success",
    data: {
      ada: `${PATH}."ada"` as SourcePath,
      grace: `${PATH}."grace"` as SourcePath,
    },
  });
}

describe("RecordFields picks its layout from the RECORD's render", () => {
  test("an inline record is edited in the block list, like an inline array", () => {
    mount(s.record(s.object({ name: s.string() })).render({ as: "inline" }));
    render(<RecordFields path={PATH} />);
    expect(screen.queryByTestId("block-list")).not.toBeNull();
    expect(screen.queryByTestId("record-list")).toBeNull();
  });

  test("an entry the caller asked to inline is still edited in place", () => {
    mount(s.record(s.object({ name: s.string() })));
    render(<RecordFields path={PATH} inline />);
    expect(screen.queryAllByTestId("any-field")).toHaveLength(2);
    expect(screen.queryByTestId("block-list")).toBeNull();
  });

  test("a record with no render keeps the list of rows", () => {
    mount(s.record(s.object({ name: s.string() })));
    render(<RecordFields path={PATH} />);
    expect(screen.queryByTestId("record-list")).not.toBeNull();
    expect(screen.queryAllByTestId("any-field")).toHaveLength(0);
  });

  /**
   * An inline list INSIDE the entry says nothing about the record it is in: a
   * render reaches one level down and no further.
   */
  test("an inline array nested in the entry does not make this record inline", () => {
    mount(
      s.record(
        s.object({ tags: s.array(s.string()).render({ as: "inline" }) }),
      ),
    );
    render(<RecordFields path={PATH} />);
    expect(screen.queryByTestId("record-list")).not.toBeNull();
    expect(screen.queryAllByTestId("any-field")).toHaveLength(0);
  });
});

/**
 * The list stays the same list while the record's preview is recomputed.
 *
 * Which list a record draws (preview rows or cards) used to be read off the
 * preview's DATA, and a preview being recomputed has none: every batch of
 * `.jsonValues()` entries landing invalidates the record's preview, so the
 * record drew cards for a moment and then preview rows again -- a different
 * component, so a new scroll viewport, back at the top. Scrolling a record of
 * 1,000 posts was thrown back to the top seven times in forty steps, which is
 * why the scale spec's scroll ended at 4,500-6,000 px
 * (`scenarios/measure/results.md`, "The Studio, built").
 */
describe("RecordFields while its preview is recomputed", () => {
  const previewed = {
    status: "success",
    data: { rows: { parent: "record", items: {} } },
  };
  beforeEach(() => {
    mockListMounts.count = 0;
    mockPreview.mockReset();
  });

  test("keeps the list it drew, rather than drawing another", () => {
    mount(s.record(s.object({ name: s.string() })));
    mockPreview.mockReturnValue(previewed);
    const { rerender } = render(<RecordFields path={PATH} />);
    expect(mockListMounts.count).toBe(1);

    // A batch of entries landed: the preview is owed again.
    mockPreview.mockReturnValue({ status: "loading" });
    act(() => rerender(<RecordFields path={PATH} />));
    mockPreview.mockReturnValue(previewed);
    act(() => rerender(<RecordFields path={PATH} />));

    expect(mockListMounts.count).toBe(1);
  });

  test("still moves to the other list when the record's preview changes kind", () => {
    mount(s.record(s.object({ name: s.string() })));
    mockPreview.mockReturnValue(previewed);
    const { rerender } = render(<RecordFields path={PATH} />);
    // The schema no longer previews its rows (a code change).
    mockPreview.mockReturnValue(undefined);
    act(() => rerender(<RecordFields path={PATH} />));
    expect(mockListMounts.count).toBe(2);
  });
});
