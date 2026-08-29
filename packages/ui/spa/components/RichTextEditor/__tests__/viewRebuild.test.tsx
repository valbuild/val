/** @jest-environment jsdom */
// FIRST, and it must stay first: the editor pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../../stores/react/testPolyfills";
import { createRef } from "react";
import { render } from "@testing-library/react";
import { RichTextEditor } from "../RichTextEditor";
import type { EditorDocument, RichTextEditorRef } from "../types";

/**
 * The editor is UNCONTROLLED, so where its document comes from is the whole
 * question.
 *
 * Two things were wrong at once and each hid the other.
 *
 * `RichTextField` passed neither `value` nor `defaultValue`, so the view always
 * mounted empty and the content arrived afterwards through `reset()` in an
 * effect whose dependencies are the SOURCE. And the view is destroyed and
 * rebuilt whenever `readOnly` or a toolbar feature changes — a rebuild that
 * re-parsed `defaultValue`, which was not there.
 *
 * So a rebuild emptied the field, and nothing refilled it: the consumer only
 * re-seeds when source moves, and source had not moved. The field rendered
 * blank and stayed blank until someone edited it somewhere else.
 *
 * The fix is both halves — mount with the document, and carry the live document
 * across a rebuild — and this file pins both, because either one alone leaves a
 * way for the field to go empty.
 */
const doc = (text: string): EditorDocument => [{ tag: "p", children: [text] }];

/**
 * The toolbars and the gutter measure the document, and jsdom has no layout —
 * `getClientRects()` returns nothing and `coordsAtPos` throws. They are not what
 * these tests are about, and turning them off is not a workaround for the
 * subject: the view is rebuilt by `readOnly` just as readily.
 */
const NO_MEASURING = {
  fixedToolbar: false,
  floatingToolbar: false,
  gutter: false,
} as const;

function textOf(editor: RichTextEditorRef | null): string {
  const value = editor?.getDocument() ?? [];
  return JSON.stringify(value);
}

describe("RichTextEditor: where the document comes from", () => {
  test("mounts with the document it was given", () => {
    const ref = createRef<RichTextEditorRef>();
    render(<RichTextEditor
        ref={ref}
        features={NO_MEASURING}
        defaultValue={doc("Hello")}
      />);

    expect(textOf(ref.current)).toContain("Hello");
  });

  /**
   * The regression guard.
   *
   * `readOnly` is one of the props the create-view effect depends on, so
   * flipping it is the cheapest way to make the view be rebuilt. What must
   * survive is the document that was on screen — not `defaultValue`, which for
   * an uncontrolled editor is a mount-time seed and says nothing about what has
   * been typed since.
   */
  test("keeps its document when the view is rebuilt", () => {
    const ref = createRef<RichTextEditorRef>();
    const { rerender } = render(
      <RichTextEditor
        ref={ref}
        features={NO_MEASURING}
        defaultValue={doc("Hello")}
      />,
    );
    expect(textOf(ref.current)).toContain("Hello");

    // A rebuild with NO defaultValue at all: the old view is the only place the
    // content exists, so this fails outright if the document is not carried.
    rerender(<RichTextEditor ref={ref} features={NO_MEASURING} readOnly />);

    expect(textOf(ref.current)).toContain("Hello");
  });

  /**
   * And a rebuild does not reach back to the mount-time seed.
   *
   * The weaker version of the test above would pass by re-parsing
   * `defaultValue`, which is right only for the case where nothing has changed.
   * Here the live document has moved on from the seed, so re-parsing would
   * silently revert it.
   */
  test("carries the live document, not the mount-time default", () => {
    const ref = createRef<RichTextEditorRef>();
    const { rerender } = render(
      <RichTextEditor
        ref={ref}
        features={NO_MEASURING}
        defaultValue={doc("First")}
      />,
    );
    ref.current?.reset(doc("Second"));
    expect(textOf(ref.current)).toContain("Second");

    rerender(
      <RichTextEditor
        ref={ref}
        features={NO_MEASURING}
        defaultValue={doc("First")}
        readOnly
      />,
    );

    expect(textOf(ref.current)).toContain("Second");
    expect(textOf(ref.current)).not.toContain("First");
  });

  /**
   * The portal container must NOT rebuild the view.
   *
   * It is filled on commit, so it arrives as `null` and then as an element on
   * the very next render — which made this the trigger in practice, before
   * anything a user did. It is read at use time now, so it is not a dependency
   * of the view at all.
   */
  test("does not rebuild when the portal container arrives", () => {
    const ref = createRef<RichTextEditorRef>();
    const container = document.createElement("div");
    const { rerender } = render(
      <RichTextEditor
        ref={ref}
        features={NO_MEASURING}
        defaultValue={doc("Hello")}
        portalContainer={null}
      />,
    );
    ref.current?.reset(doc("Edited"));

    rerender(
      <RichTextEditor
        ref={ref}
        features={NO_MEASURING}
        defaultValue={doc("Hello")}
        portalContainer={container}
      />,
    );

    expect(textOf(ref.current)).toContain("Edited");
  });
});
