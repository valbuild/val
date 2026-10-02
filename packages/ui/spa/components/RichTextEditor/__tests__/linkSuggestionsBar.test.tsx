/** @jest-environment jsdom */
// FIRST, and it must stay first: the editor pulls in the shared bundle, which
// builds a `TextEncoder` at module scope.
import "../../../stores/react/testPolyfills";
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { RichTextEditor } from "../RichTextEditor";
import type {
  EditorDocument,
  EditorLinkCatalogItem,
  RichTextEditorRef,
} from "../types";

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

describe("Add & link, in a field that only links to routes", () => {
  const PAGES: EditorLinkCatalogItem[] = [
    { title: "Jobb", subtitle: "", href: "/jobb" },
  ];
  const doc: EditorDocument = [{ tag: "p", children: ["Se https://test.com"] }];

  test("adds the URL as an external page, and links it once it is one", () => {
    const ref = createRef<RichTextEditorRef>();
    const added: string[][] = [];
    const editor = (catalog: EditorLinkCatalogItem[]) => (
      <RichTextEditor
        ref={ref}
        features={NO_MEASURING}
        defaultValue={doc}
        siteOrigins={SITE}
        routes={ROUTES}
        linkCatalog={catalog}
        externalPages={{
          canAdd: () => true,
          add: (urls) => added.push(urls),
        }}
      />
    );
    const { rerender } = render(editor(PAGES));
    expect(
      screen.getByText("https://test.com isn't an external page yet"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add & link" }));
    expect(added).toEqual([["https://test.com"]]);
    // Not linked yet: the catalog does not have it, and a link outside the
    // catalog would be stripped in the same transaction.
    expect(ref.current?.getDocument()).toEqual(doc);

    // The entry arrives, through the routes, as a catalog item.
    rerender(
      editor([
        ...PAGES,
        { title: "test.com", subtitle: "", href: "https://test.com" },
      ]),
    );
    expect(ref.current?.getDocument()).toEqual([
      {
        tag: "p",
        children: [
          "Se ",
          {
            tag: "a",
            href: "https://test.com",
            children: ["https://test.com"],
          },
        ],
      },
    ]);
    expect(screen.queryByTestId("link-suggestions-bar")).toBeNull();
  });

  test("without an external pages router, only says it cannot be linked", () => {
    render(
      <RichTextEditor
        features={NO_MEASURING}
        defaultValue={doc}
        siteOrigins={SITE}
        routes={ROUTES}
        linkCatalog={PAGES}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add & link" })).toBeNull();
    expect(
      screen.getByText(/1 URL can't be linked from this field/),
    ).toBeTruthy();
  });

  test("a URL the router or the field would refuse is not offered", () => {
    render(
      <RichTextEditor
        features={NO_MEASURING}
        defaultValue={doc}
        siteOrigins={SITE}
        routes={ROUTES}
        linkCatalog={PAGES}
        externalPages={{ canAdd: () => false, add: () => undefined }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add & link" })).toBeNull();
  });
});
