/** @jest-environment jsdom */
// FIRST, and it must stay first: the field pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../stores/react/testPolyfills";
import { act, render } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import type { EditorDocument, RichTextEditorRef } from "../RichTextEditor";
import { FIELD_WRITE_MAX_WAIT_MS } from "./useDebouncedFieldWrite";
import { RichTextField } from "./RichTextField";

/**
 * The rich text field's write cap, which is its OWN implementation.
 *
 * `RichTextField` does not go through `useDebouncedFieldWrite` — it owns a
 * hand-rolled pair of timers, because it also has to carry `hasUnsentEdit` and
 * a document captured eagerly for the unmount flush. So the hook's tests say
 * nothing about this path, and the two could drift apart silently: the bug the
 * cap fixes is invisible in the field itself, so a regression here would show
 * up only as the canvas going quiet again while someone types.
 *
 * `DEBOUNCE_MS` here is 400 and the cap is `FIELD_WRITE_MAX_WAIT_MS`, and
 * neither is injectable — so these drive the real clock values through fake
 * timers rather than passing a shorter pair in.
 */
const mockAddPatch = jest.fn();

/** The document the stub editor reports, advanced by each simulated keystroke. */
let mockEditorDocument: EditorDocument = [];
/** The field's `onDirty`, captured so a test can fire it like a keystroke. */
let mockOnDirty: (() => void) | null = null;

jest.mock("../RichTextEditor", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const Stub = React.forwardRef<RichTextEditorRef, { onDirty?: () => void }>(
    function RichTextEditorStub(props, ref) {
      mockOnDirty = props.onDirty ?? null;
      React.useImperativeHandle(ref, () => ({
        getDocument: () => mockEditorDocument,
        getPatches: () => [],
        reset: (data?: EditorDocument) => {
          mockEditorDocument = data ?? [];
        },
      }));
      return null;
    },
  );
  return { __esModule: true, RichTextEditor: Stub };
});

jest.mock("../RichTextEditor/useRichTextEditorConfig", () => ({
  __esModule: true,
  useRichTextEditorConfig: () => ({
    features: {},
    linkCatalog: undefined,
    imageModulePath: undefined,
    imageSchema: undefined,
  }),
}));

const mockRichTextSchema = {
  status: "success" as const,
  data: { type: "richtext" as const, options: {} },
};
const mockRichTextSource = {
  status: "success" as const,
  data: [] as unknown,
  clientSideOnly: false,
};

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useValConfig: () => ({ remoteHost: "https://remote.val.build" }),
  useModuleSchema: () => undefined,
  useShallowSourceAtPath: () => mockRichTextSource,
  useValField: () => ({
    schema: mockRichTextSchema,
    source: mockRichTextSource,
    patchPath: [],
    addPatch: mockAddPatch,
    addAndUploadPatchWithFileOps: jest.fn(),
    addModuleFilePatch: jest.fn(),
  }),
}));

jest.mock("../ValRemoteProvider", () => ({
  __esModule: true,
  useRemoteFiles: () => ({}),
  useCurrentRemoteFileBucket: () => null,
}));

jest.mock("../ValPortalProvider", () => ({
  __esModule: true,
  useValPortal: () => null,
}));

jest.mock("../../components/Preview", () => ({
  __esModule: true,
  PreviewLoading: () => null,
  PreviewNull: () => null,
}));

/** One keystroke: the document moves, then the editor reports itself dirty. */
function keystroke(text: string) {
  mockEditorDocument = [
    { type: "paragraph", children: [{ text }] },
  ] as unknown as EditorDocument;
  act(() => {
    mockOnDirty?.();
  });
}

/**
 * Typing with no gap the 400ms trailing debounce can fire in.
 *
 * 150ms is a fast-but-ordinary typing cadence and is the case the cap exists
 * for: every keystroke restarts the trailing timer, so without a cap the write
 * never happens however long the paragraph is.
 */
const GAP_MS = 150;

function typeContinuously(count: number, gapMs = GAP_MS) {
  for (let index = 0; index < count; index++) {
    keystroke("x".repeat(index + 1));
    act(() => {
      jest.advanceTimersByTime(gapMs);
    });
  }
}

/**
 * The keystroke count that ends exactly ON a cap firing, with none after it.
 *
 * Keystroke `k` happens at `k * GAP_MS` and the clock is then advanced one gap,
 * so the cap (armed at 0, due `FIELD_WRITE_MAX_WAIT_MS`) expires during the
 * last advance of this many keystrokes. Spelling it as a count rather than a
 * number keeps these tests honest if either constant moves: a run that ends
 * with a keystroke AFTER the cap has a legitimately pending edit, and a test
 * that did not mean to leave one there reads as a duplicate-write bug.
 */
const KEYSTROKES_TO_FIRST_CAP = Math.ceil(FIELD_WRITE_MAX_WAIT_MS / GAP_MS);

function mount() {
  return render(<RichTextField path={"/content/page.val.ts" as SourcePath} />);
}

describe("RichTextField's write cap", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAddPatch.mockClear();
    mockEditorDocument = [];
    mockOnDirty = null;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("typing with no pause still writes, and keeps writing", () => {
    mount();
    expect(mockOnDirty).not.toBeNull();

    // Just under one cap window: the trailing timer has never been reachable,
    // so without the cap this is where the write would fail to exist.
    typeContinuously(KEYSTROKES_TO_FIRST_CAP - 1);
    expect(mockAddPatch).not.toHaveBeenCalled();

    // Across it.
    typeContinuously(1);
    expect(mockAddPatch).toHaveBeenCalledTimes(1);

    // And it is a cap, not a one-off: carrying on writes again.
    typeContinuously(KEYSTROKES_TO_FIRST_CAP);
    expect(mockAddPatch.mock.calls.length).toBeGreaterThan(1);
  });

  test("the cap writes the latest document, once", () => {
    mount();
    typeContinuously(KEYSTROKES_TO_FIRST_CAP);
    expect(mockAddPatch).toHaveBeenCalledTimes(1);
    const [patch] = mockAddPatch.mock.calls[0];
    expect(patch[0].op).toBe("replace");
    // Whatever it wrote is a document that was actually typed, never a stale
    // one: the cap captures eagerly, same as the trailing timer.
    expect(JSON.stringify(patch[0].value)).toContain("x");
  });

  /**
   * The duplicate-write case, which is what `clearRunTimers` exists to prevent:
   * whichever timer gets there first has to take the other down with it.
   *
   * Both directions, because they are separate bugs. The delays are fixed at
   * 400ms and 2000ms so they can never come due in the same tick — what can
   * happen is one firing while the other is still armed, and then writing the
   * same text a second time.
   */
  test("a run that ends on the cap leaves no trailing write behind", () => {
    mount();
    // Ends exactly on the cap, so there is no keystroke after it and nothing
    // is legitimately pending.
    typeContinuously(KEYSTROKES_TO_FIRST_CAP);
    expect(mockAddPatch).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(FIELD_WRITE_MAX_WAIT_MS * 2);
    });
    expect(mockAddPatch).toHaveBeenCalledTimes(1);
  });

  test("a run that ends on the debounce leaves no capped write behind", () => {
    mount();
    keystroke("typed");
    // Past the trailing debounce but well short of the cap: the write happens
    // here, and the cap — armed by that same keystroke — must not repeat it.
    act(() => {
      jest.advanceTimersByTime(FIELD_WRITE_MAX_WAIT_MS / 2);
    });
    expect(mockAddPatch).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(FIELD_WRITE_MAX_WAIT_MS * 2);
    });
    expect(mockAddPatch).toHaveBeenCalledTimes(1);
  });

  test("typing that has pauses in it is unchanged: one write per pause", () => {
    mount();
    keystroke("one");
    act(() => {
      jest.advanceTimersByTime(FIELD_WRITE_MAX_WAIT_MS);
    });
    expect(mockAddPatch).toHaveBeenCalledTimes(1);
    keystroke("two");
    act(() => {
      jest.advanceTimersByTime(FIELD_WRITE_MAX_WAIT_MS);
    });
    expect(mockAddPatch).toHaveBeenCalledTimes(2);
  });

  /** An edit inside either window when the field goes away is written, not dropped. */
  test("unmount writes what was still pending", () => {
    const view = mount();
    keystroke("half a sentence");
    expect(mockAddPatch).not.toHaveBeenCalled();
    act(() => {
      view.unmount();
    });
    expect(mockAddPatch).toHaveBeenCalledTimes(1);
  });
});
