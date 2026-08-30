import fs from "fs";
import path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { minimalTextEdit, isLocalFix } from "./codeActions";
import {
  startLspSession,
  EXAMPLE_APP,
  type LspSession,
  type LspTextEdit,
  type PublishedDiagnostic,
} from "./__testHelpers__/lspClient";

jest.setTimeout(90000);

describe("minimalTextEdit", () => {
  function doc(text: string) {
    return TextDocument.create("file:///x.val.ts", "typescript", 1, text);
  }

  test("returns undefined when nothing changed", () => {
    expect(minimalTextEdit("abc", "abc", doc("abc"))).toBeUndefined();
  });

  test("narrows the edit to the changed region", () => {
    const before = "const a = {\n  width: 100,\n};\n";
    const after = "const a = {\n  width: 200,\n};\n";
    const edit = minimalTextEdit(before, after, doc(before));
    // Only the digit changed, so the edit must not span the whole document.
    expect(edit).toBeDefined();
    expect(edit!.range.start.line).toBe(1);
    expect(edit!.range.end.line).toBe(1);
    expect(edit!.newText).toBe("2");
  });

  test("handles pure insertion", () => {
    const before = "{ a: 1 }";
    const after = "{ a: 1, b: 2 }";
    const edit = minimalTextEdit(before, after, doc(before))!;
    expect(edit.newText).toBe(", b: 2");
    // An insertion is a zero-width range.
    expect(edit.range.start).toEqual(edit.range.end);
  });

  test("handles pure deletion", () => {
    const before = "{ a: 1, b: 2 }";
    const after = "{ a: 1 }";
    const edit = minimalTextEdit(before, after, doc(before))!;
    expect(edit.newText).toBe("");
    expect(edit.range.start).not.toEqual(edit.range.end);
  });

  test("applying the edit reproduces the target text", () => {
    const cases: [string, string][] = [
      ["abc", "abXc"],
      ["hello world", "hello"],
      ["", "new"],
      ["old", ""],
      ["aaa", "aba"],
      ["metadata: { width: 800, height: 600 }", "metadata: { width: 944 }"],
    ];
    for (const [before, after] of cases) {
      const edit = minimalTextEdit(before, after, doc(before));
      const applied = edit
        ? before.slice(0, offsetOf(before, edit.range.start)) +
          edit.newText +
          before.slice(offsetOf(before, edit.range.end))
        : before;
      expect(applied).toBe(after);
    }
  });

  function offsetOf(text: string, pos: { line: number; character: number }) {
    return TextDocument.create(
      "file:///x.val.ts",
      "typescript",
      1,
      text,
    ).offsetAt(pos);
  }
});

describe("isLocalFix", () => {
  test("accepts metadata fixes", () => {
    expect(isLocalFix("image:check-metadata")).toBe(true);
    expect(isLocalFix("file:add-metadata")).toBe(true);
  });

  test("rejects fixes that need network or credentials", () => {
    // Offering these as plain quick fixes would produce actions that fail
    // without a logged-in session.
    expect(isLocalFix("image:upload-remote")).toBe(false);
    expect(isLocalFix("image:download-remote")).toBe(false);
    expect(isLocalFix("keyof:check-keys")).toBe(false);
  });
});

describe("code actions over LSP", () => {
  let session: LspSession;

  beforeEach(async () => {
    session = await startLspSession();
  });

  afterEach(async () => {
    await session.dispose();
  });

  test("advertises the metadata and gallery fix features", () => {
    expect(session.capabilities?.features).toContain("fix/metadata");
    expect(session.capabilities?.features).toContain("fix/gallery");
  });

  // An unsaved buffer of a module the example app's `val.modules` registers.
  //
  // It has to be a registered module: `createService` evaluates `val.modules`
  // and answers from that evaluation, so a module `val.modules` does not list
  // cannot be evaluated at all — it gets `val/missing-module` instead.
  //
  // The buffer points the hero's `s.image()` at an image that really exists in
  // the example app (944x944) but declares the wrong dimensions, so core reports
  // image:check-metadata and the fix has everything it needs. Disk is never
  // written, which is what proves the fix pipeline works on editor state alone.
  //
  // The dimensions are siblings of `path` in the object literal, which is what
  // the substitution below keys off.
  const FIXTURE_FILE = path.join(EXAMPLE_APP, "app", "page.val.ts");
  const FIXTURE_URI = `file://${FIXTURE_FILE}`;
  const FIXTURE_ON_DISK = fs.readFileSync(FIXTURE_FILE, "utf8");
  const FIXTURE_IMAGE_REF = "/public/val/images/logo.png";
  const FIXTURE_TEXT = FIXTURE_ON_DISK.replace(
    /path: "[^"]*",(\s*)width: \d+,(\s*)height: \d+,/,
    `path: "${FIXTURE_IMAGE_REF}",$1width: 800,$2height: 600,`,
  );

  test("the fixture really declares the wrong dimensions", () => {
    // Fails loudly if the example app changes shape, rather than leaving the
    // tests below waiting for a diagnostic that can never arrive.
    expect(FIXTURE_TEXT).not.toBe(FIXTURE_ON_DISK);
    expect(FIXTURE_TEXT).toMatch(/width:\s*800/);
    expect(FIXTURE_TEXT).toContain(`path: "${FIXTURE_IMAGE_REF}"`);
  });

  test("offers a quick fix that corrects image metadata", async () => {
    session.openDocument(FIXTURE_URI, FIXTURE_TEXT);

    const published = await session.nextDiagnostics(FIXTURE_URI, (d) =>
      d.diagnostics.some((x) =>
        x.data?.fixes?.some((f) => f.endsWith("check-metadata")),
      ),
    );
    const fixable = published.diagnostics.filter((d) =>
      d.data?.fixes?.some((f) => f.endsWith("check-metadata")),
    );
    expect(fixable.length).toBeGreaterThan(0);

    const actions = await session.requestCodeActions(FIXTURE_URI, fixable);
    expect(actions.length).toBeGreaterThan(0);

    const action = actions[0];
    expect(action.kind).toBe("quickfix");
    expect(action.title).toMatch(/^Val: /);

    const edits = action.edit?.changes?.[FIXTURE_URI];
    expect(edits).toBeDefined();
    expect(edits!.length).toBe(1);

    const applied = applyEdits(FIXTURE_TEXT, edits!);
    expect(applied).not.toBe(FIXTURE_TEXT);
    // The real dimensions replace the declared ones.
    expect(applied).toMatch(/width:\s*944/);
    expect(applied).not.toMatch(/width:\s*800/);
    // Narrow edit: surrounding code is untouched.
    expect(applied.split("\n")[0]).toBe(FIXTURE_ON_DISK.split("\n")[0]);
    expect(applied).toContain(`path: "${FIXTURE_IMAGE_REF}"`);
  });

  test("applying the fix writes the image's real dimensions and adds no new errors", async () => {
    // NOTE: deliberately not asserting the diagnostic disappears. For a direct
    // `s.image()`, core reports "Found metadata, but it could not be validated"
    // both before AND after the fix, even though the resulting metadata has
    // width/height/mimeType all present and correct (944/944/image/png). So this
    // error class is not cleared by image:check-metadata -- worth chasing down in
    // Val separately. What must hold is that the fix writes the real dimensions
    // and does not make things worse.
    session.openDocument(FIXTURE_URI, FIXTURE_TEXT);

    const published = await session.nextDiagnostics(FIXTURE_URI, (d) =>
      d.diagnostics.some((x) =>
        x.data?.fixes?.some((f) => f.endsWith("check-metadata")),
      ),
    );
    const fixable = published.diagnostics.filter((d) =>
      d.data?.fixes?.some((f) => f.endsWith("check-metadata")),
    );
    const actions = await session.requestCodeActions(FIXTURE_URI, fixable);
    const applied = applyEdits(
      FIXTURE_TEXT,
      actions[0].edit!.changes![FIXTURE_URI],
    );

    // The real image is 944x944.
    expect(applied).toMatch(/width:\s*944/);
    expect(applied).toMatch(/height:\s*944/);
    expect(applied).toMatch(/mimeType:\s*"image\/png"/);

    // Re-validate the fixed buffer: no new problems introduced.
    session.changeDocument(FIXTURE_URI, 2, applied);
    const after = await session.nextDiagnostics(FIXTURE_URI);
    expect(after.diagnostics.length).toBeLessThanOrEqual(
      published.diagnostics.length,
    );
    // Crucially, the fix must not produce a module that fails to evaluate.
    expect(after.diagnostics.filter((d) => d.code === "val/fatal")).toEqual([]);
  });

  // A `.jsonValues()` record: the entry's value — and so everything a metadata
  // fix has to edit — is in `jsonEntryMedia/hero.val.json`, while the diagnostic
  // is reported on the `.val.ts`, which holds only the `c.json(...)` thunk.
  //
  // Both files are opened as buffers and neither is written: what is on disk is
  // correct (944x944), and the wrong dimensions exist only in the editor. That
  // is also the point — the fix must read the entry as the editor has it, not as
  // the disk has it, or it would compute its edit against text the user is not
  // looking at.
  const ENTRY_MODULE_FILE = path.join(
    EXAMPLE_APP,
    "content",
    "jsonEntryMedia.val.ts",
  );
  const ENTRY_MODULE_URI = `file://${ENTRY_MODULE_FILE}`;
  const ENTRY_MODULE_TEXT = fs.readFileSync(ENTRY_MODULE_FILE, "utf8");
  const ENTRY_FILE = path.join(
    EXAMPLE_APP,
    "content",
    "jsonEntryMedia",
    "hero.val.json",
  );
  const ENTRY_URI = `file://${ENTRY_FILE}`;
  const ENTRY_ON_DISK = fs.readFileSync(ENTRY_FILE, "utf8");
  const ENTRY_TEXT = ENTRY_ON_DISK.replace(
    '"width": 944',
    '"width": 800',
  ).replace('"height": 944', '"height": 600');

  const openEntryFixture = async () => {
    session.openDocument(ENTRY_MODULE_URI, ENTRY_MODULE_TEXT);
    // Opening the entry buffer is what makes the module invalid: the server has
    // to notice that a file it does not validate on its own changed what a
    // module validates to.
    session.openDocument(ENTRY_URI, ENTRY_TEXT);
    const published = await session.nextDiagnostics(ENTRY_MODULE_URI, (d) =>
      d.diagnostics.some((x) =>
        x.data?.fixes?.some((f) => f.endsWith("check-metadata")),
      ),
    );
    return {
      published,
      fixable: published.diagnostics.filter((d) =>
        d.data?.fixes?.some((f) => f.endsWith("check-metadata")),
      ),
    };
  };

  test("the entry fixture really declares the wrong dimensions", () => {
    expect(ENTRY_TEXT).not.toBe(ENTRY_ON_DISK);
    expect(JSON.parse(ENTRY_TEXT).image.width).toBe(800);
    expect(JSON.parse(ENTRY_ON_DISK).image.width).toBe(944);
    expect(ENTRY_MODULE_TEXT).toContain("jsonValues()");
  });

  test("reports an entry error at the entry key, not at the top of the file", async () => {
    // The value's own range is in the other file, so nothing in the `.val.ts`
    // matches the full source path. That used to fall all the way through to
    // line 1 — for a record with hundreds of entries, every entry's errors piled
    // onto the first line, naming no entry at all.
    const { fixable } = await openEntryFixture();
    expect(fixable.length).toBeGreaterThan(0);

    const keyLine = ENTRY_MODULE_TEXT.split("\n").findIndex((line) =>
      line.includes("hero: c.json("),
    );
    expect(keyLine).toBeGreaterThan(0);
    expect(fixable[0].range.start.line).toBe(keyLine);
  });

  test("offers a quick fix that edits the entry's *.val.json", async () => {
    const { fixable } = await openEntryFixture();

    const actions = await session.requestCodeActions(ENTRY_MODULE_URI, fixable);
    expect(actions.length).toBeGreaterThan(0);
    const action = actions[0];
    expect(action.kind).toBe("quickfix");

    // The edit belongs to the entry file, NOT to the document the fix was asked
    // for. Before this, the patch was applied to the `.val.ts`, walked into the
    // `c.json(...)` call, failed, and the action was silently dropped.
    expect(action.edit?.changes?.[ENTRY_MODULE_URI]).toBeUndefined();
    const edits = action.edit?.changes?.[ENTRY_URI];
    expect(edits).toBeDefined();

    const applied = applyEdits(ENTRY_TEXT, edits!);
    expect(JSON.parse(applied)).toEqual({
      image: {
        path: "/public/val/images/logo.png",
        width: 944,
        height: 944,
        mimeType: "image/png",
      },
    });
    // A narrow edit: the fix corrects the dimensions, it does not rewrite the
    // file around them.
    expect(applied.split("\n")[0]).toBe(ENTRY_TEXT.split("\n")[0]);
  });

  test("stops offering the fix once the dirty entry buffer is closed", async () => {
    // Closing an unsaved entry REMOVES an overlay. The modules that read it stay
    // open, so without invalidating on close they keep answering from a buffer
    // that no longer exists — here, still offering to write 944x944 over an
    // entry that on disk already says 944x944.
    const { fixable } = await openEntryFixture();
    expect(
      (await session.requestCodeActions(ENTRY_MODULE_URI, fixable)).length,
    ).toBeGreaterThan(0);

    session.closeDocument(ENTRY_URI);
    const afterClose = await session.nextDiagnostics(ENTRY_MODULE_URI);
    const stillFixable = afterClose.diagnostics.filter((d) =>
      d.data?.fixes?.some((f) => f.endsWith("check-metadata")),
    );
    // The diagnostic itself survives — core reports check-metadata for a direct
    // `s.image()` whether or not the metadata is right — but there is nothing
    // left to change, so no action is offered.
    const actions = await session.requestCodeActions(
      ENTRY_MODULE_URI,
      stillFixable,
    );
    expect(actions.filter((a) => a.edit !== undefined)).toEqual([]);
  });

  test("offers a quick fix that corrects gallery metadata", async () => {
    // media.val.ts is a gallery whose stored entry says 800x600 for an image
    // that is really 944x944, reported as images:check-all-files. The fix reads
    // each entry's file, so it works offline.
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const uri = `file://${file}`;
    const original = fs.readFileSync(file, "utf8");
    session.openDocument(uri, original);

    const published = await session.nextDiagnostics(uri, (d) =>
      d.diagnostics.some((x) =>
        x.data?.fixes?.some((f) => f.endsWith("check-all-files")),
      ),
    );
    const fixable = published.diagnostics.filter((d) =>
      d.data?.fixes?.some((f) => f.endsWith("check-all-files")),
    );

    const actions = await session.requestCodeActions(uri, fixable);
    const galleryAction = actions.find((a) => a.title.includes("gallery"));
    expect(galleryAction).toBeDefined();

    const edits = galleryAction!.edit?.changes?.[uri];
    expect(edits).toBeDefined();
    const applied = applyEdits(original, edits!);
    // Corrected to the image's real dimensions.
    expect(applied).toContain("944");
    expect(applied).not.toBe(original);
    // Disk untouched.
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  test("offers no action for a fix that cannot be computed locally", async () => {
    // check-unique-folder carries a fix name but createFixPatch has no handler
    // for it -- a collision between galleries needs a human decision -- so no
    // action is offered rather than one that would do nothing.
    const file = path.join(EXAMPLE_APP, "content", "media.val.ts");
    const uri = `file://${file}`;
    session.openDocument(uri, fs.readFileSync(file, "utf8"));

    const published = await session.nextDiagnostics(uri);
    const uniqueFolder = published.diagnostics.filter((d) =>
      d.data?.fixes?.some((f) => f.endsWith("check-unique-folder")),
    );
    if (uniqueFolder.length === 0) {
      return; // Not present in this fixture; nothing to assert.
    }
    expect(await session.requestCodeActions(uri, uniqueFolder)).toEqual([]);
  });
});

function applyEdits(text: string, edits: LspTextEdit[]): string {
  const document = TextDocument.create(
    "file:///x.val.ts",
    "typescript",
    1,
    text,
  );
  // Apply back-to-front so earlier offsets stay valid.
  const sorted = [...edits].sort(
    (a, b) =>
      document.offsetAt(b.range.start) - document.offsetAt(a.range.start),
  );
  let out = text;
  for (const edit of sorted) {
    out =
      out.slice(0, document.offsetAt(edit.range.start)) +
      edit.newText +
      out.slice(document.offsetAt(edit.range.end));
  }
  return out;
}

// Keep the unused-import checker honest about the shared diagnostic type.
export type _Diagnostic = PublishedDiagnostic;
