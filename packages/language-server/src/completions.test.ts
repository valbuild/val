import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  findMediaPathObject,
  getValCompletionContext,
} from "./completionContext";
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

  test("names the property a string is the value of", () => {
    // This is what a media-path completion keys off: the cursor is in the value
    // of a `path` property, and the schema at the CONTAINER decides whether it
    // is media at all.
    const context = contextAt(`export default c.define("/x", schema, {
  image: { path: "/public/val/|" },
});`);
    expect(context).toMatchObject({
      kind: "string-value",
      isPropertyName: false,
      valueOfProperty: "path",
      currentText: "/public/val/",
    });
  });

  test("works on an empty string and at both quote edges", () => {
    expect(contextAt(`const a = { path: "|" };`)?.currentText).toBe("");
    expect(contextAt(`const a = { path: "|abc" };`)?.currentText).toBe("abc");
    expect(contextAt(`const a = { path: "abc|" };`)?.currentText).toBe("abc");
  });

  test("reports nothing outside a string", () => {
    expect(contextAt(`const a = { path: "/p.png" }|;`)).toBeUndefined();
  });

  test("distinguishes an object key from a value", () => {
    // Which schema describes the string depends on this: a value is described by
    // the schema at its own path, a key by its container's.
    expect(
      contextAt(`export default c.define("/x", schema, { "|/a.png": {} });`),
    ).toMatchObject({ kind: "string-value", isPropertyName: true });
    expect(
      contextAt(`export default c.define("/x", schema, { a: "|value" });`),
    ).toMatchObject({ kind: "string-value", isPropertyName: false });
  });

  test("names the property across a multi-line object", () => {
    expect(
      contextAt(`const a = {
  path: "|/public/val/logo.png",
  width: 1,
  height: 2,
};`),
    ).toMatchObject({ valueOfProperty: "path" });
  });

  test("picks the innermost string when nested", () => {
    expect(
      contextAt(`const a = { outer: { path: "|/a.pdf" } };`),
    ).toMatchObject({ valueOfProperty: "path" });
  });

  test("a sibling metadata value is not the path", () => {
    expect(
      contextAt(`const a = { path: "/p.png", mimeType: "|image/png" };`),
    ).toMatchObject({ valueOfProperty: "mimeType" });
  });
});

describe("string literals without a closing quote", () => {
  /**
   * A client that does not auto-close quotes (a hand-written Neovim config, say)
   * leaves `path: "` unterminated while the user types. Bounding the literal at
   * `getEnd() - 1` excluded every position inside it, so such a client got no
   * completions at all.
   */
  function contextAt(source: string) {
    const offset = source.indexOf("|");
    const text = source.replace("|", "");
    return getValCompletionContext(
      ts.createSourceFile("/x.val.ts", text, ts.ScriptTarget.ES2020),
      offset,
    );
  }

  test("names the path property inside an unterminated literal", () => {
    const context = contextAt(`export default c.define("/x", schema, {
  image: { path: "|
});`);
    expect(context).toMatchObject({
      kind: "string-value",
      valueOfProperty: "path",
      currentText: "",
    });
  });

  test("offers a string value inside an unterminated literal", () => {
    const context = contextAt(`export default c.define("/x", schema, {
  author: "fr|
});`);
    expect(context?.kind).toBe("string-value");
    if (context?.kind !== "string-value") return;
    expect(context.currentText).toBe("fr");
  });

  test("an escaped trailing quote does not count as the terminator", () => {
    const context = contextAt(`export default c.define("/x", schema, {
  author: "a\\"|
});`);
    expect(context?.kind).toBe("string-value");
  });
});

describe("findMediaPathObject", () => {
  /**
   * Guards the file-corruption case: `completionItem/resolve` used to replay the
   * offsets captured when the list was built, so typing to filter and then
   * accepting an item inserted the metadata *inside* the string literal.
   */
  function parse(text: string) {
    return ts.createSourceFile("/x.val.ts", text, ts.ScriptTarget.ES2020);
  }

  const before = `export default c.define("/x", schema, {
  image: { path: "" },
});`;
  // What the document looks like after the user typed "logo" to filter the list.
  const after = `export default c.define("/x", schema, {
  image: { path: "logo" },
});`;
  const pathValueStart = before.indexOf('path: "') + "path: ".length;

  test("re-derives the insertion point after the literal grew", () => {
    const stale = getValCompletionContext(parse(before), pathValueStart + 1);
    expect(stale).toMatchObject({ valueOfProperty: "path" });

    const fresh = findMediaPathObject(parse(after), pathValueStart)!;
    expect(fresh).toBeDefined();
    // The end moved by the four characters typed; the stale value would have
    // pointed into the middle of the literal.
    expect(fresh.insertAfter).toBe(
      after.indexOf('path: "logo"') + 'path: "logo"'.length,
    );
    expect(after.slice(fresh.insertAfter, fresh.insertAfter + 1)).toBe(" ");
  });

  test("finds existing metadata properties to replace", () => {
    const text = `export default c.define("/x", schema, {
  image: { path: "logo", width: 1, height: 2 },
});`;
    const start = text.indexOf('path: "') + "path: ".length;
    const found = findMediaPathObject(parse(text), start)!;
    expect(
      text.slice(found.existing.width!.start, found.existing.width!.end),
    ).toBe("1");
    expect(
      text.slice(found.existing.height!.start, found.existing.height!.end),
    ).toBe("2");
    expect(found.existing.mimeType).toBeUndefined();
  });

  test("reports nothing when the anchor no longer resolves", () => {
    // Better no metadata than metadata in the wrong place.
    expect(findMediaPathObject(parse(after), 9999)).toBeUndefined();
  });

  test("reports nothing for a path that is not in an object literal", () => {
    const text = `const a = ["/public/val/logo.png"];`;
    expect(findMediaPathObject(parse(text), text.indexOf('"'))).toBeUndefined();
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

  afterEach(async () => {
    await session.dispose();
  });

  test("advertises the media path completion feature", () => {
    expect(session.capabilities?.features).toContain("completions/mediaPath");
  });

  /**
   * An unsaved buffer of a module the example app's `val.modules` registers.
   *
   * It has to be a registered module: media-path completions are schema-driven
   * now (`path` is an ordinary property name — only the schema says it is a
   * file), and the schema comes from the project snapshot. A module `val.modules`
   * does not list is never evaluated, so there is no schema to consult.
   *
   * `mediaFields.val.ts` declares one of each field this needs, all starting
   * null: a bare `s.image()`, one with its own `directory`, a gallery-backed
   * one, and an `s.file()`.
   */
  const MEDIA_FIELDS_FILE = path.join(
    EXAMPLE_APP,
    "content",
    "mediaFields.val.ts",
  );
  const MEDIA_FIELDS_URI = `file://${MEDIA_FIELDS_FILE}`;
  const MEDIA_FIELDS_ON_DISK = fs.readFileSync(MEDIA_FIELDS_FILE, "utf8");

  /** The same module with one field given an empty media object. */
  function withEmptyPath(field: string) {
    const text = MEDIA_FIELDS_ON_DISK.replace(
      `${field}: null,`,
      `${field}: { path: "" },`,
    );
    if (text === MEDIA_FIELDS_ON_DISK) {
      throw new Error(`mediaFields.val.ts no longer has \`${field}: null\``);
    }
    return text;
  }

  /** Completions offered where the empty path is. */
  async function completionsInEmptyPath(text: string) {
    session.openDocument(MEDIA_FIELDS_URI, text);
    const document = TextDocument.create(
      MEDIA_FIELDS_URI,
      "typescript",
      1,
      text,
    );
    return session.requestCompletions(
      MEDIA_FIELDS_URI,
      document.positionAt(text.indexOf('path: ""') + 'path: "'.length),
    );
  }

  test("offers existing images inside an image field's path", async () => {
    const items = await completionsInEmptyPath(withEmptyPath("image"));

    const labels = items.map((i) => i.label);
    // The example app really has this image.
    expect(labels).toContain("/public/val/images/logo.png");
    // An image field must not offer non-images.
    expect(labels.some((l) => l.endsWith(".webm"))).toBe(false);
    // Each item replaces the string contents rather than inserting at the cursor.
    expect(items[0].textEdit).toBeDefined();
  });

  test("offers non-image files inside a file field's path", async () => {
    const items = await completionsInEmptyPath(withEmptyPath("file"));

    const labels = items.map((i) => i.label);
    expect(labels).toContain("/public/val/file_example.webm");
    expect(labels).toContain("/public/val/images/logo.png");
  });

  test("honours the field's own directory", async () => {
    // `imageInSubdir` declares `directory: "/public/test/fields"`. The old
    // completion keyed off the callee name and ignored the field entirely, so it
    // offered every image in the project.
    const items = await completionsInEmptyPath(withEmptyPath("imageInSubdir"));
    expect(items.map((i) => i.label)).not.toContain(
      "/public/val/images/logo.png",
    );
  });

  test("falls back to the directory of the gallery a field references", async () => {
    // `fromGallery` points at mediaFixtures.val.ts, whose directory is
    // /public/test/subdir.
    const items = await completionsInEmptyPath(withEmptyPath("fromGallery"));
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("/public/val/images/logo.png");
    expect(labels.every((l) => l.startsWith("/public/test/subdir/"))).toBe(
      true,
    );
  });

  test("resolving an item fills in the metadata siblings", async () => {
    const items = await completionsInEmptyPath(withEmptyPath("image"));
    const logo = items.find((i) => i.label === "/public/val/images/logo.png");
    expect(logo).toBeDefined();

    const resolved = await session.resolveCompletion(logo!);
    expect(resolved.additionalTextEdits).toBeDefined();
    const [edit] = resolved.additionalTextEdits!;
    // Real dimensions of the example app's logo, read from the file itself.
    expect(edit.newText).toContain("944");
    expect(edit.newText).toContain('mimeType: "image/png"');
    // Inserted after the path property, not replacing it.
    expect(edit.newText.startsWith(", width:")).toBe(true);
    expect(edit.range.start).toEqual(edit.range.end);
  });

  test("resolving a gallery-backed item writes no metadata", async () => {
    // The dimensions and mime type live in the gallery module. Writing them here
    // too is how two copies of one fact get to disagree.
    const items = await completionsInEmptyPath(withEmptyPath("fromGallery"));
    expect(items.length).toBeGreaterThan(0);

    const resolved = await session.resolveCompletion(items[0]);
    expect(resolved.additionalTextEdits).toBeUndefined();
  });

  test("offers nothing for a path that is not media", async () => {
    // `path` is an ordinary property name. Only the schema says otherwise, so a
    // plain object with one must not get a list of the project's files.
    const uri = `file://${path.join(EXAMPLE_APP, "content", "authors.val.ts")}`;
    const text = `import { c, s } from "../val.config";
export default c.define(
  "/content/authors.val.ts",
  s.record(s.object({ link: s.object({ path: s.string() }) })),
  { freekh: { link: { path: "" } } },
);
`;
    session.openDocument(uri, text);
    const document = TextDocument.create(uri, "typescript", 1, text);
    const items = await session.requestCompletions(
      uri,
      document.positionAt(text.indexOf('path: ""') + 'path: "'.length),
    );
    expect(items).toEqual([]);
  });

  test("advertises the keyOf completion feature", () => {
    expect(session.capabilities?.features).toContain("completions/keyOf");
  });

  test("offers the referenced record's keys for an s.keyOf field", async () => {
    // page.val.ts declares `author: s.keyOf(authorsVal)`, so the candidates are
    // the keys of /content/authors.val.ts -- a different module, which is why
    // this needs the project-wide snapshot.
    const file = path.join(EXAMPLE_APP, "app", "page.val.ts");
    const pageUri = `file://${file}`;
    const original = fs.readFileSync(file, "utf8");
    session.openDocument(pageUri, original);
    await session.nextDiagnostics(pageUri);

    const match = original.match(/author:\s*"([^"]*)"/);
    expect(match).not.toBeNull();
    const document = TextDocument.create(pageUri, "typescript", 1, original);
    // Put the cursor just inside the opening quote of the author value.
    const offset =
      original.indexOf(match![0]) +
      match![0].indexOf('"', "author:".length) +
      1;

    const items = await session.requestCompletions(
      pageUri,
      document.positionAt(offset),
    );
    const labels = items.map((i) => i.label);

    // Real author keys from the other module.
    expect(labels).toContain("freekh");
    expect(labels.length).toBeGreaterThan(1);
    // Replaces the string contents rather than inserting.
    expect(items[0].textEdit).toBeDefined();
  });

  test("advertises the route completion feature", () => {
    expect(session.capabilities?.features).toContain("completions/route");
  });

  test("offers the project's routes for an s.route field", async () => {
    // page.val.ts declares `link: s.route()`. The candidates are the keys of the
    // project's router modules, so this also needs the snapshot.
    const file = path.join(EXAMPLE_APP, "app", "page.val.ts");
    const pageUri = `file://${file}`;
    const original = fs.readFileSync(file, "utf8");
    session.openDocument(pageUri, original);
    await session.nextDiagnostics(pageUri);

    const match = original.match(/\n\s+link:\s*"([^"]*)"/);
    expect(match).not.toBeNull();
    const document = TextDocument.create(pageUri, "typescript", 1, original);
    const offset =
      original.indexOf(match![0]) + match![0].indexOf('"', "link:".length) + 1;

    const items = await session.requestCompletions(
      pageUri,
      document.positionAt(offset),
    );
    const labels = items.map((i) => i.label);
    expect(labels.length).toBeGreaterThan(0);

    // Internal pages: the root page exists in the example app.
    expect(labels).toContain("/");
    expect(labels.some((l) => l.startsWith("/blogs/"))).toBe(true);

    // External URLs are valid route values too -- the example app registers them
    // through a router module using externalPageRouter -- so they belong in the
    // candidate list rather than being filtered out.
    const external = items.filter((i) => i.label.startsWith("https://"));
    expect(external.length).toBeGreaterThan(0);
    expect(external[0].detail).toBe("/app/external.val.ts");

    // Every item says which module defines it, so an internal page and an
    // external link are distinguishable in the list.
    for (const item of items) {
      expect(item.detail).toMatch(/\.val\.ts$/);
      expect(item.textEdit).toBeDefined();
    }
  });

  test("advertises the gallery key and richtext link features", () => {
    expect(session.capabilities?.features).toContain("completions/galleryKey");
    expect(session.capabilities?.features).toContain(
      "completions/richtextLink",
    );
  });

  test("offers files from the gallery's own directory as record keys", async () => {
    // media.val.ts is `s.images({ directory: "/public/val/images" })`, keyed by
    // file reference. A key is described by its container, so the candidates come
    // from the record's declared directory -- not the project-wide files dir.
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const galleryUri = `file://${file}`;
    const original = fs.readFileSync(file, "utf8");
    session.openDocument(galleryUri, original);
    await session.nextDiagnostics(galleryUri);

    const document = TextDocument.create(galleryUri, "typescript", 1, original);
    // Cursor just inside the opening quote of the existing entry key.
    const keyOffset = original.indexOf('"/public/val/images/logo.png"') + 1;
    const items = await session.requestCompletions(
      galleryUri,
      document.positionAt(keyOffset),
    );

    const labels = items.map((i) => i.label);
    expect(labels).toContain("/public/val/images/logo.png");
    // Scoped to the gallery's directory: the webm sits in /public/val, not
    // /public/val/images, so it must not be offered.
    expect(labels.some((l) => l.endsWith(".webm"))).toBe(false);
    for (const label of labels) {
      expect(label.startsWith("/public/val/images/")).toBe(true);
    }
  });

  test("offers routes for a route field nested deep inside a router record", async () => {
    // link.href is `s.route()` inside an object, inside a record keyed by route.
    // Exercises the position -> module path walk at depth.
    const file = path.join(
      EXAMPLE_APP,
      "app",
      "blogs",
      "[blog]",
      "page.val.ts",
    );
    const blogUri = `file://${file}`;
    const original = fs.readFileSync(file, "utf8");
    session.openDocument(blogUri, original);
    await session.nextDiagnostics(blogUri);

    const document = TextDocument.create(blogUri, "typescript", 1, original);
    const offset = original.indexOf('href: "') + 'href: "'.length;
    const items = await session.requestCompletions(
      blogUri,
      document.positionAt(offset),
    );

    expect(items.map((i) => i.label)).toContain("/");
    expect(items.length).toBeGreaterThan(1);
  });

  test("offers routes for a richtext inline link href", async () => {
    // A richtext link is a plain `{ tag: "a", href }` node, which Val does not
    // describe with a schema, so the candidates come from the enclosing
    // richtext's `a` option instead.
    const file = path.join(
      EXAMPLE_APP,
      "app",
      "blogs",
      "[blog]",
      "page.val.ts",
    );
    const blogUri = `file://${file}`;
    const original = fs.readFileSync(file, "utf8");

    // The example app's richtext content has only `tag: "p"` nodes, so add a link
    // in the buffer. The file exists on disk, so the snapshot picks up the edit.
    const withLink = original.replace(
      '          tag: "p",\n          children: ["Blog 2 content"],',
      '          tag: "p",\n          children: [{ tag: "a", href: "", children: ["x"] }],',
    );
    expect(withLink).not.toBe(original);

    session.openDocument(blogUri, original);
    await session.nextDiagnostics(blogUri);
    session.changeDocument(blogUri, 2, withLink);
    await session.nextDiagnostics(blogUri);

    const document = TextDocument.create(blogUri, "typescript", 1, withLink);
    const offset = withLink.indexOf('href: ""') + 'href: "'.length;
    const items = await session.requestCompletions(
      blogUri,
      document.positionAt(offset),
    );

    expect(items.map((i) => i.label)).toContain("/");
    expect(items.length).toBeGreaterThan(1);
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
