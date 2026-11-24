/** @jest-environment jsdom */
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import type { SourcePath } from "@valbuild/core";
import { useFieldShownInColumn } from "./useFieldShownInColumn";

const TITLE = '/content/page.val.ts?p="title"' as SourcePath;
const BODY = '/content/page.val.ts?p="body"' as SourcePath;
const FOOTER = '/content/site.val.ts?p="footer"' as SourcePath;

type Props = { selected: SourcePath | null; editing: SourcePath | null };

/*
 * Under StrictMode, as `usePickingDefault.test.tsx` is and for its reason:
 * the hook adjusts state while rendering, and a render React runs twice is
 * where bookkeeping kept anywhere but state comes apart.
 */
function render(initial: Props) {
  return renderHook(
    ({ selected, editing }: Props) => useFieldShownInColumn(selected, editing),
    { initialProps: initial, wrapper: StrictMode },
  );
}

describe("the field the column shows as selected", () => {
  test("is the one the editor is on", () => {
    const { result, rerender } = render({ selected: TITLE, editing: null });
    expect(result.current).toBe(TITLE);
    rerender({ selected: BODY, editing: null });
    expect(result.current).toBe(BODY);
    rerender({ selected: null, editing: null });
    expect(result.current).toBeNull();
  });

  test("is the one being typed in on the page, wherever the editor is", () => {
    const { result, rerender } = render({ selected: TITLE, editing: null });
    rerender({ selected: TITLE, editing: FOOTER });
    expect(result.current).toBe(FOOTER);
  });

  test("stays on it once the edit has ended", () => {
    const { result, rerender } = render({ selected: TITLE, editing: null });
    rerender({ selected: TITLE, editing: FOOTER });
    rerender({ selected: TITLE, editing: null });
    expect(result.current).toBe(FOOTER);
  });

  test("moves with the next text typed in", () => {
    const { result, rerender } = render({ selected: TITLE, editing: null });
    rerender({ selected: TITLE, editing: FOOTER });
    rerender({ selected: TITLE, editing: null });
    rerender({ selected: TITLE, editing: BODY });
    expect(result.current).toBe(BODY);
  });

  test("gives way when the editor moves", () => {
    const { result, rerender } = render({ selected: TITLE, editing: null });
    rerender({ selected: TITLE, editing: FOOTER });
    rerender({ selected: TITLE, editing: null });
    // A row opened in the column, a search hit, an ordinary pick.
    rerender({ selected: BODY, editing: null });
    expect(result.current).toBe(BODY);
  });

  test("...but not while something is being typed in", () => {
    const { result, rerender } = render({ selected: TITLE, editing: null });
    rerender({ selected: TITLE, editing: FOOTER });
    rerender({ selected: BODY, editing: FOOTER });
    expect(result.current).toBe(FOOTER);
  });

  test("an edit that is already going on when the column mounts is shown", () => {
    const { result } = render({ selected: TITLE, editing: FOOTER });
    expect(result.current).toBe(FOOTER);
  });
});
