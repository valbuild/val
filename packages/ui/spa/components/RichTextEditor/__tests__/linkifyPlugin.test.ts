/** @jest-environment jsdom */
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo } from "prosemirror-history";
import { buildSchema } from "../schema";
import { parseEditorDocument } from "../serialize/parseEditorDocument";
import { serializeEditorDocument } from "../serialize/serializeEditorDocument";
import { createLinkCatalogPlugin } from "../plugins/linkCatalogPlugin";
import {
  applyLinkFixes,
  createLinkifyPlugin,
  linkifyPluginKey,
  unlinkAutoLinked,
} from "../plugins/linkifyPlugin";
import { createLinkHelper } from "../plugins/formattingToolbarShared";
import type { LinkContext } from "../linkify";
import type {
  EditorDocument,
  EditorLinkCatalogItem,
  LinkPickerState,
} from "../types";

const schema = buildSchema();

function setup(
  doc: EditorDocument,
  opts: {
    catalog?: EditorLinkCatalogItem[];
    routes?: string[];
    readOnly?: boolean;
  } = {},
) {
  const catalog = opts.catalog;
  const ctx: LinkContext = {
    siteOrigins: ["https://blank.no"],
    routes: opts.routes ?? ["/", "/jobb"],
    allowedHrefs: catalog?.map((item) => item.href),
  };
  const pickerStates: (LinkPickerState | null)[] = [];
  const linkHelper = createLinkHelper({
    getLinkCatalog: () => catalog,
    onPickerStateChange: (state) => pickerStates.push(state),
    isPickerOpen: () => false,
  });
  const state = EditorState.create({
    doc: parseEditorDocument(doc, schema),
    plugins: [
      history(),
      createLinkifyPlugin({
        linkType: schema.marks.link,
        getContext: () => ctx,
        getLinkCatalog: () => catalog,
        linkHelper,
        readOnly: opts.readOnly ?? false,
      }),
      createLinkCatalogPlugin({ getLinkCatalog: () => catalog }),
    ],
  });
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, { state });
  // jsdom has no layout, and the link editor is anchored to the selection's
  // coordinates. Where it is placed is not what these tests are about.
  view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  return {
    view,
    pickerStates,
    value: () => serializeEditorDocument(view.state.doc),
  };
}

/** jsdom has no ClipboardEvent; this is one, structurally. */
function pasteEvent() {
  return Object.assign(new Event("paste"), { clipboardData: null });
}

function cursorAt(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

function typeText(view: EditorView, text: string) {
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, char, () => view.state.tr.insertText(char, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

function pressModK(view: EditorView) {
  view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
  );
}

describe("paste", () => {
  test("links the URLs in pasted text, and turns this site into paths", () => {
    const { view, value } = setup([{ tag: "p", children: ["Se: "] }]);
    cursorAt(view, 5);
    view.pasteText("https://ssb.no og https://blank.no/jobb", pasteEvent());
    expect(value()).toEqual([
      {
        tag: "p",
        children: [
          "Se: ",
          { tag: "a", href: "https://ssb.no", children: ["https://ssb.no"] },
          " og ",
          { tag: "a", href: "/jobb", children: ["https://blank.no/jobb"] },
        ],
      },
    ]);
  });

  test("a URL on this site with no page is left as text, and is an error", () => {
    const { view, value } = setup([{ tag: "p", children: [""] }]);
    cursorAt(view, 1);
    view.pasteText("https://blank.no/borte", pasteEvent());
    expect(value()).toEqual([
      { tag: "p", children: ["https://blank.no/borte"] },
    ]);
    expect(linkifyPluginKey.getState(view.state)?.scan.missing).toHaveLength(1);
    const highlighted = view.dom.querySelector(
      '[data-error-kind="link.missing-page"]',
    );
    expect(highlighted?.textContent).toBe("https://blank.no/borte");
    expect(highlighted?.getAttribute("title")).toBe(
      "There is no page at /borte on this site",
    );
  });

  test("a URL pasted over a selection links the selection", () => {
    const { view, value } = setup([
      { tag: "p", children: ["Les hele rapporten her"] },
    ]);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 19)),
    );
    view.pasteText("https://blank.no/jobb", pasteEvent());
    expect(value()).toEqual([
      {
        tag: "p",
        children: [
          "Les ",
          { tag: "a", href: "/jobb", children: ["hele rapporten"] },
          " her",
        ],
      },
    ]);
  });

  test("one undo takes back the paste and the linking together", () => {
    const { view, value } = setup([{ tag: "p", children: ["a"] }]);
    cursorAt(view, 2);
    view.pasteText(" https://ssb.no", pasteEvent());
    undo(view.state, view.dispatch);
    expect(value()).toEqual([{ tag: "p", children: ["a"] }]);
  });

  test("'Keep as text' takes back the linking and keeps the paste", () => {
    const { view, value } = setup([{ tag: "p", children: [""] }]);
    cursorAt(view, 1);
    view.pasteText("https://ssb.no https://nav.no", pasteEvent());
    expect(
      linkifyPluginKey.getState(view.state)?.autoLinked?.ranges,
    ).toHaveLength(2);
    unlinkAutoLinked(view);
    expect(value()).toEqual([
      { tag: "p", children: ["https://ssb.no https://nav.no"] },
    ]);
    expect(linkifyPluginKey.getState(view.state)?.autoLinked).toBeNull();
  });

  test("a pasted link to this site's full address survives the catalog", () => {
    const { view, value } = setup([{ tag: "p", children: [""] }], {
      catalog: [{ title: "Jobb", subtitle: "", href: "/jobb" }],
    });
    cursorAt(view, 1);
    view.pasteHTML(
      '<a href="https://blank.no/jobb">Ledige stillinger</a>',
      pasteEvent(),
    );
    expect(value()).toEqual([
      {
        tag: "p",
        children: [
          { tag: "a", href: "/jobb", children: ["Ledige stillinger"] },
        ],
      },
    ]);
  });

  test("an external URL outside the catalog is not linked", () => {
    const { view, value } = setup([{ tag: "p", children: [""] }], {
      catalog: [{ title: "Jobb", subtitle: "", href: "/jobb" }],
    });
    cursorAt(view, 1);
    view.pasteText("https://ssb.no", pasteEvent());
    expect(value()).toEqual([{ tag: "p", children: ["https://ssb.no"] }]);
    expect(linkifyPluginKey.getState(view.state)?.scan.notAllowed).toHaveLength(
      1,
    );
  });

  test("nothing happens in a read-only editor", () => {
    const { view, value } = setup([{ tag: "p", children: [""] }], {
      readOnly: true,
    });
    cursorAt(view, 1);
    view.pasteText("https://ssb.no", pasteEvent());
    expect(value()).toEqual([{ tag: "p", children: ["https://ssb.no"] }]);
  });

  test("pasting into a code block links nothing", () => {
    const { view, value } = setup([{ tag: "pre", children: [""] }]);
    cursorAt(view, 1);
    view.pasteText("https://ssb.no", pasteEvent());
    expect(value()).toEqual([{ tag: "pre", children: ["https://ssb.no"] }]);
  });
});

describe("typing", () => {
  test("a URL becomes a link when the space after it is typed", () => {
    const { view, value } = setup([{ tag: "p", children: [""] }]);
    cursorAt(view, 1);
    typeText(view, "Se https://blank.no/jobb. Takk");
    expect(value()).toEqual([
      {
        tag: "p",
        children: [
          "Se ",
          { tag: "a", href: "/jobb", children: ["https://blank.no/jobb"] },
          ". Takk",
        ],
      },
    ]);
  });

  test("a URL still being typed is not linked", () => {
    const { view, value } = setup([{ tag: "p", children: [""] }]);
    cursorAt(view, 1);
    typeText(view, "https://ssb.no");
    expect(value()).toEqual([{ tag: "p", children: ["https://ssb.no"] }]);
  });
});

describe("⌘K", () => {
  test("on a bare URL, links it", () => {
    const { view, value } = setup([
      { tag: "p", children: ["Se https://ssb.no nå"] },
    ]);
    cursorAt(view, 8);
    pressModK(view);
    expect(value()).toEqual([
      {
        tag: "p",
        children: [
          "Se ",
          { tag: "a", href: "https://ssb.no", children: ["https://ssb.no"] },
          " nå",
        ],
      },
    ]);
  });

  test("on a selection, opens the link editor", () => {
    const { view, pickerStates } = setup([
      { tag: "p", children: ["Les rapporten"] },
    ]);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 14)),
    );
    pressModK(view);
    expect(pickerStates.at(-1)).toMatchObject({
      kind: "url",
      savedFrom: 5,
      savedTo: 14,
      isNewLink: true,
    });
  });

  test("inside a link, selects the whole link and opens its editor", () => {
    const { view, pickerStates } = setup([
      {
        tag: "p",
        children: [
          "Les ",
          { tag: "a", href: "https://ssb.no", children: ["rapporten"] },
        ],
      },
    ]);
    cursorAt(view, 8);
    pressModK(view);
    expect(pickerStates.at(-1)).toMatchObject({
      kind: "url",
      savedFrom: 5,
      savedTo: 14,
      currentHref: "https://ssb.no",
    });
  });
});

describe("applyLinkFixes", () => {
  test("links every bare URL, and rewrites this site's full address", () => {
    const { view, value } = setup([
      {
        tag: "p",
        children: [
          "https://ssb.no, https://blank.no/borte og ",
          { tag: "a", href: "https://blank.no/", children: ["forsiden"] },
        ],
      },
    ]);
    applyLinkFixes(view);
    expect(value()).toEqual([
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://ssb.no", children: ["https://ssb.no"] },
          ", https://blank.no/borte og ",
          { tag: "a", href: "/", children: ["forsiden"] },
        ],
      },
    ]);
  });
});
