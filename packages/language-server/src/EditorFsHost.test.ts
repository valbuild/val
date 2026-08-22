import fs from "fs";
import os from "os";
import path from "path";
import { createEditorFsHost, mapOpenDocuments } from "./EditorFsHost";

describe("createEditorFsHost", () => {
  let dir: string;
  let onDisk: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-editor-fs-"));
    onDisk = path.join(dir, "saved.val.ts");
    fs.writeFileSync(onDisk, "// on disk\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("reads from disk when the file is not open in the editor", () => {
    const host = createEditorFsHost(mapOpenDocuments());
    expect(host.readFile(onDisk)).toBe("// on disk\n");
  });

  test("prefers the editor buffer over disk", () => {
    // This is the whole point of the host: validate what the user is looking at,
    // not what was last saved.
    const open = mapOpenDocuments();
    open.set(onDisk, "// unsaved edit\n");
    const host = createEditorFsHost(open);
    expect(host.readFile(onDisk)).toBe("// unsaved edit\n");
  });

  test("normalises paths when matching the overlay", () => {
    const open = mapOpenDocuments();
    open.set(onDisk, "// unsaved edit\n");
    const host = createEditorFsHost(open);
    const messy = path.join(dir, ".", "saved.val.ts");
    expect(host.readFile(messy)).toBe("// unsaved edit\n");
  });

  test("reports a never-saved buffer as existing", () => {
    const unsaved = path.join(dir, "brand-new.val.ts");
    const open = mapOpenDocuments();
    open.set(unsaved, "// only in the editor\n");
    const host = createEditorFsHost(open);
    expect(fs.existsSync(unsaved)).toBe(false);
    expect(host.fileExists(unsaved)).toBe(true);
    expect(host.readFile(unsaved)).toBe("// only in the editor\n");
  });

  test("falls through to disk for fileExists", () => {
    const host = createEditorFsHost(mapOpenDocuments());
    expect(host.fileExists(onDisk)).toBe(true);
    expect(host.fileExists(path.join(dir, "nope.ts"))).toBe(false);
  });

  test("readBuffer serves the editor buffer as bytes", () => {
    const open = mapOpenDocuments();
    open.set(onDisk, "// unsaved edit\n");
    const host = createEditorFsHost(open);
    expect(host.readBuffer(onDisk)?.toString("utf8")).toBe("// unsaved edit\n");
  });

  test("readBuffer returns undefined rather than throwing for a missing file", () => {
    const host = createEditorFsHost(mapOpenDocuments());
    expect(host.readBuffer(path.join(dir, "nope.bin"))).toBeUndefined();
  });

  test("refuses to write or delete files", () => {
    // A language server must never touch the user's files directly -- edits go
    // through the editor as workspace edits so they land in the undo stack.
    const host = createEditorFsHost(mapOpenDocuments());
    expect(() => host.writeFile(onDisk, "nope", "utf8")).toThrow(
      /must not write files directly/,
    );
    expect(() => host.rmFile(onDisk)).toThrow(/must not delete files directly/);
    expect(fs.readFileSync(onDisk, "utf8")).toBe("// on disk\n");
  });
});
