/** @jest-environment jsdom */
// FIRST, and it must stay first: the editor pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../../stores/react/testPolyfills";
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { RichTextEditor } from "../RichTextEditor";
import type { EditorDocument, RichTextEditorRef } from "../types";

/** See `viewRebuild.test.tsx`: jsdom has no layout for these to measure. */
const NO_MEASURING = {
  fixedToolbar: false,
  floatingToolbar: false,
  gutter: false,
} as const;

const SITE = ["https://blank.no"];
const ROUTES = ["/", "/jobb"];

function renderEditor(
  defaultValue: EditorDocument,
  props: { readOnly?: boolean } = {},
) {
  const ref = createRef<RichTextEditorRef>();
  render(
    <RichTextEditor
      ref={ref}
      features={NO_MEASURING}
      defaultValue={defaultValue}
      siteOrigins={SITE}
      routes={ROUTES}
      {...props}
    />,
  );
  return ref;
}

describe("the link bar under the field", () => {
  test("says how many URLs are not links, and links them all", () => {
    const ref = renderEditor([
      {
        tag: "p",
        children: ["Se https://ssb.no og https://blank.no/jobb"],
      },
    ]);
    expect(screen.getByText("2 URLs aren't links yet")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Link all" }));

    expect(ref.current?.getDocument()).toEqual([
      {
        tag: "p",
        children: [
          "Se ",
          { tag: "a", href: "https://ssb.no", children: ["https://ssb.no"] },
          " og ",
          { tag: "a", href: "/jobb", children: ["https://blank.no/jobb"] },
        ],
      },
    ]);
    expect(screen.queryByTestId("link-suggestions-bar")).toBeNull();
  });

  test("lists a missing page as an error, and cannot be told to go away", () => {
    renderEditor([{ tag: "p", children: ["https://blank.no/borte"] }]);
    expect(
      screen.getByText("There is no page at /borte on this site"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link all" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Leave these as text" }),
    ).toBeNull();
  });

  test("leaving the URLs as text hides the bar", () => {
    renderEditor([{ tag: "p", children: ["https://ssb.no"] }]);
    fireEvent.click(
      screen.getByRole("button", { name: "Leave these as text" }),
    );
    expect(screen.queryByTestId("link-suggestions-bar")).toBeNull();
  });

  test("says 'Fix all' when a link uses the site's full address", () => {
    const ref = renderEditor([
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://blank.no/jobb", children: ["Jobb"] },
        ],
      },
    ]);
    expect(
      screen.getByText("1 link uses this site's full address"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fix all" }));
    expect(ref.current?.getDocument()).toEqual([
      {
        tag: "p",
        children: [{ tag: "a", href: "/jobb", children: ["Jobb"] }],
      },
    ]);
  });

  test("is not shown in a read-only editor", () => {
    renderEditor([{ tag: "p", children: ["https://ssb.no"] }], {
      readOnly: true,
    });
    expect(screen.queryByTestId("link-suggestions-bar")).toBeNull();
  });

  test("is not shown when the field has no links", () => {
    const ref = createRef<RichTextEditorRef>();
    render(
      <RichTextEditor
        ref={ref}
        features={{ ...NO_MEASURING, link: false }}
        defaultValue={[{ tag: "p", children: ["https://ssb.no"] }]}
        siteOrigins={SITE}
        routes={ROUTES}
      />,
    );
    expect(screen.queryByTestId("link-suggestions-bar")).toBeNull();
  });
});
