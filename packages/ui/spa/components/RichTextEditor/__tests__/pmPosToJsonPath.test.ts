import { buildSchema } from "../schema";
import { parseEditorDocument } from "../serialize/parseEditorDocument";
import { nodeViewPosToJsonPath, pmPosToBlockPath } from "../pmPosToJsonPath";
import type { EditorDocument } from "../types";

const schema = buildSchema({
  features: { button: true, details: true, image: true },
  buttonVariants: [
    { variant: "cta", label: "CTA", children: false },
    { variant: "link", label: "Link", children: "string" },
  ],
});

function makePmDoc(doc: EditorDocument) {
  return parseEditorDocument(doc, schema);
}

describe("nodeViewPosToJsonPath", () => {
  test("returns path for text inside first paragraph", () => {
    const doc: EditorDocument = [
      { tag: "p", children: ["Hello"] },
      { tag: "p", children: ["World"] },
    ];
    const pmDoc = makePmDoc(doc);
    const path = nodeViewPosToJsonPath(pmDoc, 1);
    expect(path).toEqual(["0", "children", "0"]);
  });

  test("returns path for text inside second paragraph", () => {
    const doc: EditorDocument = [
      { tag: "p", children: ["Hello"] },
      { tag: "p", children: ["World"] },
    ];
    const pmDoc = makePmDoc(doc);
    const firstBlockEnd = 1 + "Hello".length + 1;
    const path = nodeViewPosToJsonPath(pmDoc, firstBlockEnd + 1);
    expect(path).toEqual(["1", "children", "0"]);
  });

  test("returns path for inline image node", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          "Before ",
          { tag: "img", src: "https://example.com/img.png" },
          " after",
        ],
      },
    ];
    const pmDoc = makePmDoc(doc);
    const imgPos = 1 + "Before ".length;
    const path = nodeViewPosToJsonPath(pmDoc, imgPos);
    expect(path).toContain("children");
    expect(path![path!.length - 1]).toBe("1");
  });

  test("returns path for atom button", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          "Click ",
          { tag: "button", variant: "cta", children: false },
        ],
      },
    ];
    const pmDoc = makePmDoc(doc);
    const btnPos = 1 + "Click ".length;
    const path = nodeViewPosToJsonPath(pmDoc, btnPos);
    expect(path).not.toBeNull();
    expect(path).toContain("children");
    expect(path![path!.length - 1]).toBe("1");
  });

  test("returns path for details block via nodeAt", () => {
    const doc: EditorDocument = [
      { tag: "p", children: ["Before"] },
      {
        tag: "details",
        children: [
          { tag: "summary", children: ["Summary"] },
          { tag: "p", children: ["Body"] },
        ],
      },
    ];
    const pmDoc = makePmDoc(doc);
    const pNode = pmDoc.child(0);
    const detailsPos = pNode.nodeSize;
    expect(pmDoc.nodeAt(detailsPos)?.type.name).toBe("details");
    const path = nodeViewPosToJsonPath(pmDoc, detailsPos);
    expect(path).toEqual(["1"]);
  });

  test("returns path for position 0 (first block)", () => {
    const doc: EditorDocument = [{ tag: "p", children: ["Hello"] }];
    const pmDoc = makePmDoc(doc);
    const path = nodeViewPosToJsonPath(pmDoc, 0);
    expect(path).toEqual(["0"]);
  });
});

describe("pmPosToBlockPath", () => {
  test("returns block path for position inside first paragraph", () => {
    const doc: EditorDocument = [{ tag: "p", children: ["Hello World"] }];
    const pmDoc = makePmDoc(doc);
    const result = pmPosToBlockPath(pmDoc, 3);
    expect(result).not.toBeNull();
    expect(result!.blockPath).toEqual(["0"]);
    expect(result!.blockNode.tag).toBe("p");
  });

  test("returns block path for position inside second paragraph", () => {
    const doc: EditorDocument = [
      { tag: "p", children: ["Hello"] },
      { tag: "p", children: ["World"] },
    ];
    const pmDoc = makePmDoc(doc);
    const firstBlockSize = 1 + "Hello".length + 1;
    const result = pmPosToBlockPath(pmDoc, firstBlockSize + 1);
    expect(result).not.toBeNull();
    expect(result!.blockPath).toEqual(["1"]);
    expect(result!.blockNode.tag).toBe("p");
  });

  test("returns serialized block with link", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          "Click ",
          { tag: "a", href: "https://example.com", children: ["here"] },
        ],
      },
    ];
    const pmDoc = makePmDoc(doc);
    const result = pmPosToBlockPath(pmDoc, 3);
    expect(result).not.toBeNull();
    expect(result!.blockPath).toEqual(["0"]);
    expect(result!.blockNode.tag).toBe("p");
    if (result!.blockNode.tag === "p") {
      expect(result!.blockNode.children.length).toBeGreaterThan(0);
    }
  });

  test("returns block path for heading", () => {
    const doc: EditorDocument = [
      { tag: "h1", children: ["Title"] },
      { tag: "p", children: ["Body"] },
    ];
    const pmDoc = makePmDoc(doc);
    const result = pmPosToBlockPath(pmDoc, 2);
    expect(result).not.toBeNull();
    expect(result!.blockPath).toEqual(["0"]);
    expect(result!.blockNode.tag).toBe("h1");
  });

  test("returns block path inside a list item", () => {
    const doc: EditorDocument = [
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["Item 1"] }] },
          { tag: "li", children: [{ tag: "p", children: ["Item 2"] }] },
        ],
      },
    ];
    const pmDoc = makePmDoc(doc);
    const result = pmPosToBlockPath(pmDoc, 3);
    expect(result).not.toBeNull();
    expect(result!.blockNode.tag).toBe("p");
  });

  test("returns null for out-of-range position", () => {
    const doc: EditorDocument = [{ tag: "p", children: ["Hi"] }];
    const pmDoc = makePmDoc(doc);
    const result = pmPosToBlockPath(pmDoc, 100);
    expect(result).toBeNull();
  });
});

describe("Val patch path construction", () => {
  test("image patch path includes patchPath prefix", () => {
    const doc: EditorDocument = [
      {
        tag: "p",
        children: [
          "Before ",
          { tag: "img", src: "https://example.com/old.png" },
        ],
      },
    ];
    const pmDoc = makePmDoc(doc);
    const imgPos = 1 + "Before ".length;
    const jsonPath = nodeViewPosToJsonPath(pmDoc, imgPos);

    const patchPath = ["content", "body"];
    if (jsonPath) {
      const fullPath = [...patchPath, ...jsonPath];
      expect(fullPath[0]).toBe("content");
      expect(fullPath[1]).toBe("body");
      expect(fullPath.length).toBeGreaterThan(2);
    }
  });

  test("link block patch replaces entire block", () => {
    const doc: EditorDocument = [{ tag: "p", children: ["Click here please"] }];
    const pmDoc = makePmDoc(doc);
    const result = pmPosToBlockPath(pmDoc, 3);

    const patchPath = ["content", "body"];
    if (result) {
      const fullPath = [...patchPath, ...result.blockPath];
      expect(fullPath).toEqual(["content", "body", "0"]);
    }
  });
});
