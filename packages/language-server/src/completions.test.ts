import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getValCompletionContext } from "./completionContext";
import { createPublicValFiles } from "./publicValFiles";
import {
  startLspSession,
  EXAMPLE_APP,
  type LspSession,
} from "./__testHelpers__/lspClient";

jest.setTimeout(90000);

describe("getValCompletionContext", () => {
  /** Returns the context at the position marked by `|` in the source. */
  function contextAt(source: string) {
    const offset = source.indexOf("|");
    const text = source.replace("|", "");
    return getValCompletionContext(
      ts.createSourceFile("/x.val.ts", text, ts.ScriptTarget.ES2020),
      offset,
    );
  }

  test("detects the cursor inside c.image()'s reference argument", () => {
    const context = contextAt(`export default c.define("/x", schema, {
  image: c.image("/public/val/|"),
});`);
    expect(context?.kind).toBe("file-ref");
    expect(context?.subType).toBe("image");
    expect(context?.currentText).toBe("/public/val/");
  });

  test("detects c.file() as well", () => {
    expect(contextAt(`const a = c.file("|");`)?.subType).toBe("file");
  });

  test("works on an empty string and at both quote edges", () => {
    expect(contextAt(`const a = c.image("|");`)?.subType).toBe("image");
    expect(contextAt(`const a = c.image("|abc");`)?.currentText).toBe("abc");
    expect(contextAt(`const a = c.image("abc|");`)?.currentText).toBe("abc");
  });

  test("reports an existing metadata argument so it can be replaced", () => {
    const context = contextAt(
      `const a = c.image("|/p.png", { width: 1, height: 2 });`,
    );
    expect(context?.metadataStart).toBeDefined();
    expect(context?.metadataEnd).toBeDefined();
  });

  test("reports no metadata argument when there is none", () => {
    const context = contextAt(`const a = c.image("|/p.png");`);
    expect(context?.metadataStart).toBeUndefined();
  });

  test("returns undefined outside a file reference", () => {
    expect(contextAt(`const a = c.image("/p.png")|;`)).toBeUndefined();
    expect(contextAt(`const a = "|just a string";`)).toBeUndefined();
    expect(contextAt(`const a = somethingElse("|/p.png");`)).toBeUndefined();
    // The metadata argument is not the reference argument.
    expect(
      contextAt(`const a = c.image("/p.png", { width: |1 });`),
    ).toBeUndefined();
  });

  test("handles a multi-line call", () => {
    const context = contextAt(`const a = c.image(
  "|/public/val/logo.png",
  { width: 1, height: 2, mimeType: "image/png" },
);`);
    expect(context?.subType).toBe("image");
    expect(context?.metadataStart).toBeDefined();
  });

  test("picks the innermost call when nested", () => {
    // Contrived, but proves the walk descends rather than stopping at the outer
    // call expression.
    const context = contextAt(`const a = wrap(c.file("|/a.pdf"));`);
    expect(context?.subType).toBe("file");
  });
});

describe("createPublicValFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-public-"));
    fs.mkdirSync(path.join(dir, "public", "val", "images"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(dir, "public", "val", "images", "a.png"), "x");
    fs.writeFileSync(path.join(dir, "public", "val", "doc.pdf"), "x");
    fs.writeFileSync(path.join(dir, "public", "val", ".DS_Store"), "x");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("lists files as Val-style refs, including the /public prefix", () => {
    const files = createPublicValFiles({ valRoot: dir });
    expect(files.list().map((f) => f.ref)).toEqual([
      "/public/val/doc.pdf",
      "/public/val/images/a.png",
    ]);
  });

  test("skips dotfiles", () => {
    const refs = createPublicValFiles({ valRoot: dir })
      .list()
      .map((f) => f.ref);
    expect(refs.some((r) => r.includes(".DS_Store"))).toBe(false);
  });

  test("derives mime types and filters images", () => {
    const files = createPublicValFiles({ valRoot: dir });
    expect(files.images().map((f) => f.ref)).toEqual([
      "/public/val/images/a.png",
    ]);
    expect(files.list().find((f) => f.ref.endsWith(".pdf"))?.mimeType).toBe(
      "application/pdf",
    );
  });

  test("returns nothing when the directory does not exist", () => {
    expect(
      createPublicValFiles({ valRoot: path.join(dir, "nope") }).list(),
    ).toEqual([]);
  });

  test("caches briefly, and invalidate() forces a re-read", () => {
    const clock = 1000;
    const files = createPublicValFiles({ valRoot: dir, now: () => clock });
    expect(files.list()).toHaveLength(2);

    fs.writeFileSync(path.join(dir, "public", "val", "new.png"), "x");
    // Within the cache window the new file is not visible yet.
    expect(files.list()).toHaveLength(2);

    files.invalidate();
    expect(files.list()).toHaveLength(3);
  });

  test("picks up new files once the cache window passes", () => {
    let clock = 1000;
    const files = createPublicValFiles({ valRoot: dir, now: () => clock });
    expect(files.list()).toHaveLength(2);
    fs.writeFileSync(path.join(dir, "public", "val", "new.png"), "x");
    clock += 5000;
    expect(files.list()).toHaveLength(3);
  });
});

describe("completions over LSP", () => {
  let session: LspSession;
  const uri = `file://${path.join(EXAMPLE_APP, "content", "fixtureCompletion.val.ts")}`;

  beforeEach(async () => {
    session = await startLspSession();
  });

  afterEach(() => {
    session.dispose();
  });

  test("advertises the media path completion feature", () => {
    expect(session.capabilities?.features).toContain("completions/mediaPath");
  });

  test("offers existing files inside c.image()", async () => {
    const text = `import { s, c } from "../val.config";
export default c.define("/content/fixtureCompletion.val.ts", s.object({ image: s.image() }), {
  image: c.image(""),
});
`;
    session.openDocument(uri, text);

    const document = TextDocument.create(uri, "typescript", 1, text);
    const items = await session.requestCompletions(
      uri,
      document.positionAt(text.indexOf('c.image("') + 'c.image("'.length),
    );

    const labels = items.map((i) => i.label);
    // The example app really has this image.
    expect(labels).toContain("/public/val/images/logo.png");
    // c.image() must not offer non-images.
    expect(labels.some((l) => l.endsWith(".webm"))).toBe(false);
    // Each item replaces the string contents rather than inserting at the cursor.
    expect(items[0].textEdit).toBeDefined();
  });

  test("offers non-image files inside c.file()", async () => {
    const text = `import { s, c } from "../val.config";
export default c.define("/content/fixtureCompletion.val.ts", s.object({ f: s.file() }), {
  f: c.file(""),
});
`;
    session.openDocument(uri, text);

    const document = TextDocument.create(uri, "typescript", 1, text);
    const items = await session.requestCompletions(
      uri,
      document.positionAt(text.indexOf('c.file("') + 'c.file("'.length),
    );

    const labels = items.map((i) => i.label);
    expect(labels).toContain("/public/val/file_example.webm");
    expect(labels).toContain("/public/val/images/logo.png");
  });

  test("resolving an item fills in the metadata argument", async () => {
    const text = `import { s, c } from "../val.config";
export default c.define("/content/fixtureCompletion.val.ts", s.object({ image: s.image() }), {
  image: c.image(""),
});
`;
    session.openDocument(uri, text);

    const document = TextDocument.create(uri, "typescript", 1, text);
    const items = await session.requestCompletions(
      uri,
      document.positionAt(text.indexOf('c.image("') + 'c.image("'.length),
    );
    const logo = items.find((i) => i.label === "/public/val/images/logo.png");
    expect(logo).toBeDefined();

    const resolved = await session.resolveCompletion(logo!);
    expect(resolved.additionalTextEdits).toBeDefined();
    const [edit] = resolved.additionalTextEdits!;
    // Real dimensions of the example app's logo, read from the file itself.
    expect(edit.newText).toContain("944");
    expect(edit.newText).toContain('mimeType: "image/png"');
    // Inserted after the reference argument, not replacing it.
    expect(edit.newText.startsWith(", {")).toBe(true);
    expect(edit.range.start).toEqual(edit.range.end);
  });

  test("offers nothing outside a file reference", async () => {
    const text = `import { s, c } from "../val.config";
export default c.define("/content/fixtureCompletion.val.ts", s.object({ a: s.string() }), {
  a: "",
});
`;
    session.openDocument(uri, text);

    const document = TextDocument.create(uri, "typescript", 1, text);
    const items = await session.requestCompletions(
      uri,
      document.positionAt(text.indexOf('a: "') + 'a: "'.length),
    );
    expect(items).toEqual([]);
  });
});
