import { buildSchema } from "../schema";
import { parseEditorDocument } from "../serialize/parseEditorDocument";
import { serializeEditorDocument } from "../serialize/serializeEditorDocument";
import { createLinkCatalogPlugin } from "../plugins/linkCatalogPlugin";
import type { EditorDocument, EditorLinkCatalogItem } from "../types";
import { EditorState } from "prosemirror-state";

const schema = buildSchema();

function createState(doc: EditorDocument, catalog: EditorLinkCatalogItem[]) {
  const pmDoc = parseEditorDocument(doc, schema);
  return EditorState.create({
    doc: pmDoc,
    plugins: [createLinkCatalogPlugin({ getLinkCatalog: () => catalog })],
  });
}

describe("link catalog enforcement", () => {
  const catalog: EditorLinkCatalogItem[] = [
    { title: "Allowed", subtitle: "ok", href: "https://allowed.example.com" },
    { title: "Also OK", subtitle: "fine", href: "https://also-ok.example.com" },
  ];

  test("strips link marks whose href is not in the catalog", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          "Visit ",
          {
            tag: "a",
            href: "https://disallowed.example.com",
            children: ["bad link"],
          },
        ],
      },
    ];

    const state = createState(doc, catalog);

    const tr = state.tr.insertText("x", 1, 1);
    const newState = state.apply(tr);

    const serialized = serializeEditorDocument(newState.doc);
    const para = serialized[0];
    expect(para.tag).toBe("p");
    if (para.tag !== "p") return;

    const hasDisallowedLink = para.children.some(
      (c) =>
        typeof c === "object" &&
        c.tag === "a" &&
        c.href === "https://disallowed.example.com",
    );
    expect(hasDisallowedLink).toBe(false);

    const textContent = para.children
      .map((c) =>
        typeof c === "string"
          ? c
          : "children" in c && Array.isArray(c.children)
            ? c.children.join("")
            : "",
      )
      .join("");
    expect(textContent).toContain("bad link");
  });

  test("preserves link marks whose href is in the catalog", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          {
            tag: "a",
            href: "https://allowed.example.com",
            children: ["good link"],
          },
        ],
      },
    ];

    const state = createState(doc, catalog);

    const tr = state.tr.insertText("x", 1, 1);
    const newState = state.apply(tr);

    const serialized = serializeEditorDocument(newState.doc);
    const para = serialized[0];
    expect(para.tag).toBe("p");
    if (para.tag !== "p") return;

    const hasAllowedLink = para.children.some(
      (c) =>
        typeof c === "object" &&
        c.tag === "a" &&
        c.href === "https://allowed.example.com",
    );
    expect(hasAllowedLink).toBe(true);
  });

  test("no-ops when catalog is empty", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://any-url.example.com", children: ["link"] },
        ],
      },
    ];

    const state = createState(doc, []);

    const tr = state.tr.insertText("x", 1, 1);
    const newState = state.apply(tr);

    const serialized = serializeEditorDocument(newState.doc);
    const para = serialized[0];
    expect(para.tag).toBe("p");
    if (para.tag !== "p") return;

    const hasLink = para.children.some(
      (c) =>
        typeof c === "object" &&
        c.tag === "a" &&
        c.href === "https://any-url.example.com",
    );
    expect(hasLink).toBe(true);
  });
});
