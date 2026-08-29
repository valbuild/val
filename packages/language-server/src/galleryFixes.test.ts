import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { RenameFile, TextDocumentEdit, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  canRenameFiles,
  createGalleryMembershipActions,
  findRecordInsertion,
} from "./galleryFixes";
import {
  startLspSession,
  EXAMPLE_APP,
  type LspSession,
} from "./__testHelpers__/lspClient";

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile("m.val.ts", text, ts.ScriptTarget.ES2020, true);
}

const GALLERY = `import { c, s } from "../val.config";

export default c.define(
  "/content/g.val.ts",
  s.images({ directory: "/public/img" }),
  {
    "/public/img/a.png": { width: 8, height: 8, mimeType: "image/png", alt: null },
  },
);
`;

describe("findRecordInsertion", () => {
  test("inserts after the last entry, matching its indentation", () => {
    const sourceFile = parse(GALLERY);
    const insertion = findRecordInsertion(sourceFile);
    expect(insertion).not.toBeNull();
    expect(insertion?.hasProperties).toBe(true);
    expect(insertion?.indentation).toBe("    ");
    // Immediately after the last entry, so the text lands before the brace.
    expect(GALLERY.slice(insertion?.insertOffset)).toBe(",\n  },\n);\n");
  });

  test("inserts inside the braces of an empty record", () => {
    const text = `export default c.define("/m.val.ts", s.images({}), {});\n`;
    const insertion = findRecordInsertion(parse(text));
    expect(insertion?.hasProperties).toBe(false);
    expect(text.slice(insertion?.insertOffset)).toBe("});\n");
  });

  test("returns null when c.define has no record argument", () => {
    expect(
      findRecordInsertion(
        parse(`export default c.define("/m.val.ts", s.string(), "x");\n`),
      ),
    ).toBeNull();
  });

  test("what it produces still parses, and keeps the existing entry", () => {
    const insertion = findRecordInsertion(parse(GALLERY));
    if (!insertion) {
      throw new Error("expected an insertion point");
    }
    const entry = `"/public/img/b.png": { width: 4, height: 4, mimeType: "image/png", alt: null }`;
    const inserted =
      GALLERY.slice(0, insertion.insertOffset) +
      `,\n${insertion.indentation}${entry}` +
      GALLERY.slice(insertion.insertOffset);
    const keys: string[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) {
        keys.push(node.name.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(parse(inserted));
    expect(keys).toEqual(
      expect.arrayContaining(["/public/img/a.png", "/public/img/b.png"]),
    );
  });
});

describe("canRenameFiles", () => {
  test("requires the client to have announced rename support", () => {
    // A RenameFile sent to a client that did not announce it is silently
    // dropped, which would rewrite the path and leave the file behind.
    expect(
      canRenameFiles({
        workspace: {
          workspaceEdit: { resourceOperations: ["create", "rename"] },
        },
      }),
    ).toBe(true);
    expect(
      canRenameFiles({
        workspace: { workspaceEdit: { resourceOperations: ["create"] } },
      }),
    ).toBe(false);
    expect(canRenameFiles({ workspace: { workspaceEdit: {} } })).toBe(false);
    expect(canRenameFiles({})).toBe(false);
    expect(canRenameFiles(undefined)).toBe(false);
  });
});

describe("gallery membership over LSP", () => {
  let session: LspSession;
  jest.setTimeout(90000);

  beforeEach(async () => {
    session = await startLspSession();
  });
  afterEach(() => {
    session.dispose();
  });

  test("does not mistake 'must not carry its own width' for a membership problem", async () => {
    // Core emits TWO fixless errors on a gallery-backed field: the membership
    // one, and this one. They are indistinguishable from the schema alone, so
    // the discriminator is whether the path is already a key in the gallery.
    // Offering "add it to the gallery" for a path the gallery already has would
    // be nonsense, and the fix would be a no-op the user could not understand.
    const file = path.join(EXAMPLE_APP, "content", "mediaFields.val.ts");
    const original = fs.readFileSync(file, "utf8");
    const text = original.replace(
      "fromGallery: null,",
      'fromGallery: { path: "/public/test/subdir/red-8x8_bfbd0.png", width: 8 },',
    );
    expect(text).not.toBe(original);
    const uri = `file://${file}`;
    session.openDocument(uri, text);

    const published = await session.nextDiagnostics(uri, (d) =>
      d.diagnostics.some((x) => x.message.includes("must not carry its own")),
    );
    const complaint = published.diagnostics.find((d) =>
      d.message.includes("must not carry its own"),
    );
    expect(complaint).toBeDefined();
    // Reported, but NOT as a membership problem: the gallery does have this path.
    expect(complaint!.data?.code).toBe("val/validation");
    expect(
      published.diagnostics.filter(
        (d) => d.data?.code === "val/gallery-membership",
      ),
    ).toEqual([]);
  });

  test("advertises the gallery diagnostics feature", () => {
    expect(session.capabilities?.features).toContain("diagnostics/gallery");
  });

  test("reports a gallery-backed field pointing outside its gallery", async () => {
    // mediaFields.val.ts has `fromGallery: s.image(mediaGalleryVal)`, whose
    // gallery keeps /public/test/subdir. logo.png is a real file somewhere else,
    // which is the case where "move it" is the remedy rather than "register it".
    const file = path.join(EXAMPLE_APP, "content", "mediaFields.val.ts");
    const original = fs.readFileSync(file, "utf8");
    const text = original.replace(
      "fromGallery: null,",
      'fromGallery: { path: "/public/val/images/logo.png" },',
    );
    expect(text).not.toBe(original);
    const uri = `file://${file}`;
    session.openDocument(uri, text);

    const published = await session.nextDiagnostics(uri, (d) =>
      d.diagnostics.some((x) => x.data?.code === "val/gallery-membership"),
    );
    const membership = published.diagnostics.find(
      (d) => d.data?.code === "val/gallery-membership",
    );
    expect(membership).toBeDefined();
    // The data a fix needs, resolved from the schema rather than the message.
    expect(membership!.data?.gallery?.referencedModule).toBe(
      "/content/mediaFixtures.val.ts",
    );
    expect(membership!.data?.gallery?.directory).toBe("/public/test/subdir");
    expect(membership!.data?.gallery?.path).toBe("/public/val/images/logo.png");
    expect(membership!.data?.gallery?.mediaType).toBe("image");

    const actions = await session.requestCodeActions(uri, [membership!]);
    const move = actions.find((a) => a.title.includes("move"));
    // The harness announces no resourceOperations, so a rename must NOT be
    // offered: sending one would rewrite the path and leave the file behind.
    expect(move).toBeUndefined();
    // Nor may it be offered as "register": the path is outside the gallery's
    // directory, so registering it would break the gallery's own check.
    expect(actions.find((a) => a.title.includes("add"))).toBeUndefined();
    // Disk untouched.
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
});

describe("createGalleryMembershipActions", () => {
  // The LSP harness announces no resourceOperations and the example app has no
  // untracked file inside a gallery's directory, so the two POSITIVE paths are
  // driven directly against a temporary project.
  let root: string;

  const galleryModule = `import { c, s } from "../val.config";

export default c.define(
  "/content/g.val.ts",
  s.images({ directory: "/public/img" }),
  {
    "/public/img/tracked.png": { width: 8, height: 8, mimeType: "image/png", alt: null },
  },
);
`;

  // An 8x8 solid-colour PNG, so the metadata extractor has real bytes to read.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD//" +
      "/+l2Z/dAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB9oIBRELLnJqTAAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==",
    "base64",
  );

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-gallery-"));
    fs.mkdirSync(path.join(root, "content"), { recursive: true });
    fs.mkdirSync(path.join(root, "public", "img"), { recursive: true });
    fs.mkdirSync(path.join(root, "public", "elsewhere"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "g.val.ts"), galleryModule);
    fs.writeFileSync(path.join(root, "public", "img", "untracked.png"), PNG);
    fs.writeFileSync(path.join(root, "public", "elsewhere", "stray.png"), PNG);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function fieldDocument(mediaPath: string): TextDocument {
    return TextDocument.create(
      `file://${path.join(root, "content", "page.val.ts")}`,
      "typescript",
      1,
      `export default c.define("/content/page.val.ts", s.object({}), {\n  hero: { path: ${JSON.stringify(
        mediaPath,
      )} },\n});\n`,
    );
  }

  test("registers a file that is inside the gallery's directory", async () => {
    const actions = await createGalleryMembershipActions({
      document: fieldDocument("/public/img/untracked.png"),
      gallery: {
        referencedModule: "/content/g.val.ts",
        directory: "/public/img",
        path: "/public/img/untracked.png",
        mediaType: "image",
      },
      valRoot: root,
      read: () => undefined,
      allowRename: true,
    });
    const add = actions.find((a) => a.title.includes("add"));
    expect(add).toBeDefined();
    const galleryUri = `file://${path.join(root, "content", "g.val.ts")}`;
    const edits = add!.edit?.changes?.[galleryUri];
    expect(edits).toBeDefined();
    // Applying it must keep the file parseable and add exactly the new key,
    // with the metadata read from the real bytes rather than invented.
    const before = fs.readFileSync(
      path.join(root, "content", "g.val.ts"),
      "utf8",
    );
    const applied = TextDocument.applyEdits(
      TextDocument.create(galleryUri, "typescript", 1, before),
      edits!,
    );
    expect(applied).toContain('"/public/img/untracked.png"');
    expect(applied).toContain("width: 8");
    expect(applied).toContain("height: 8");
    expect(applied).toContain('mimeType: "image/png"');
    // The existing entry survives.
    expect(applied).toContain('"/public/img/tracked.png"');
    // Disk untouched: an accepted edit is applied by the client.
    expect(
      fs.readFileSync(path.join(root, "content", "g.val.ts"), "utf8"),
    ).toBe(before);
  });

  test("offers a rename for a file outside the directory, when allowed", async () => {
    const actions = await createGalleryMembershipActions({
      document: fieldDocument("/public/elsewhere/stray.png"),
      gallery: {
        referencedModule: "/content/g.val.ts",
        directory: "/public/img",
        path: "/public/elsewhere/stray.png",
        mediaType: "image",
      },
      valRoot: root,
      read: () => undefined,
      allowRename: true,
    });
    const move = actions.find((a) => a.title.includes("move"));
    expect(move).toBeDefined();
    const changes = move!.edit?.documentChanges ?? [];
    const rename = changes.find(RenameFile.is);
    expect(rename).toBeDefined();
    expect(rename!.newUri).toContain("/public/img/stray.png");
    // ...and the field's path is rewritten to match, or the move would break it.
    const textChange = changes.find(TextDocumentEdit.is);
    expect(textChange).toBeDefined();
    // LSP 10 widened `TextDocumentEdit.edits` to include `SnippetTextEdit`,
    // which carries `snippet` rather than `newText`. This edit is a plain one.
    const firstEdit = textChange!.edits[0];
    expect(TextEdit.is(firstEdit)).toBe(true);
    expect(TextEdit.is(firstEdit) && firstEdit.newText).toBe(
      "/public/img/stray.png",
    );
    // Registering it instead must NOT be offered: that would break the gallery's
    // own directory check.
    expect(actions.find((a) => a.title.includes("add"))).toBeUndefined();
  });

  test("offers nothing for a path with no file behind it", async () => {
    const actions = await createGalleryMembershipActions({
      document: fieldDocument("/public/img/ghost.png"),
      gallery: {
        referencedModule: "/content/g.val.ts",
        directory: "/public/img",
        path: "/public/img/ghost.png",
        mediaType: "image",
      },
      valRoot: root,
      read: () => undefined,
      allowRename: true,
    });
    // Registering a path with no file would trade this diagnostic for a
    // "file does not exist" one.
    expect(actions).toEqual([]);
  });

  test("withholds the rename when the client cannot do renames", async () => {
    const actions = await createGalleryMembershipActions({
      document: fieldDocument("/public/elsewhere/stray.png"),
      gallery: {
        referencedModule: "/content/g.val.ts",
        directory: "/public/img",
        path: "/public/elsewhere/stray.png",
        mediaType: "image",
      },
      valRoot: root,
      read: () => undefined,
      allowRename: false,
    });
    expect(actions).toEqual([]);
  });
});
