import { compare, type Operation } from "fast-json-patch";
import type { EditorDocument } from "../types";

describe("RFC 6902 patches on EditorDocument JSON", () => {
  test("adding a paragraph produces an add operation", () => {
    const before: EditorDocument = [{ tag: "p", children: ["Hello"] }];
    const after: EditorDocument = [
      { tag: "p", children: ["Hello"] },
      { tag: "p", children: ["World"] },
    ];
    const patches = compare(before, after);
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.some((p: Operation) => p.op === "add")).toBe(true);
  });

  test("changing text produces a replace operation", () => {
    const before: EditorDocument = [{ tag: "p", children: ["Hello"] }];
    const after: EditorDocument = [{ tag: "p", children: ["Hello World"] }];
    const patches = compare(before, after);
    expect(patches.length).toBeGreaterThan(0);
    const replacePatch = patches.find((p: Operation) => p.op === "replace");
    expect(replacePatch).toBeDefined();
  });

  test("removing a block produces a remove operation", () => {
    const before: EditorDocument = [
      { tag: "p", children: ["First"] },
      { tag: "p", children: ["Second"] },
    ];
    const after: EditorDocument = [{ tag: "p", children: ["First"] }];
    const patches = compare(before, after);
    expect(patches.some((p: Operation) => p.op === "remove")).toBe(true);
  });

  test("adding a style produces a patch", () => {
    const before: EditorDocument = [{ tag: "p", children: ["plain"] }];
    const after: EditorDocument = [
      {
        tag: "p",
        children: [{ tag: "span", styles: ["bold"], children: ["plain"] }],
      },
    ];
    const patches = compare(before, after);
    expect(patches.length).toBeGreaterThan(0);
  });

  test("patches use JSON Pointer paths", () => {
    const before: EditorDocument = [{ tag: "p", children: ["Hello"] }];
    const after: EditorDocument = [{ tag: "p", children: ["World"] }];
    const patches = compare(before, after);
    for (const p of patches) {
      expect(p.path).toMatch(/^\//);
    }
  });
});
