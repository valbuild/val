import fs from "fs";
import os from "os";
import path from "path";
import {
  deserializeSchema,
  initVal,
  Internal,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextEdit } from "vscode-languageserver";
import { createValCodeActions, isLocalFix } from "./codeActions";
import { isRemoteFix, REMOTE_FIX_COMMANDS } from "./commands";
import {
  createValDiagnostics,
  galleryMembershipAt,
  isGalleryCheckFix,
  type ValDiagnosticData,
} from "./diagnostics";
import { createGalleryMembershipActions } from "./galleryFixes";
import type { ValModuleContent } from "./ValProject";

/**
 * The editor's side of `s.videoset()`: the same fixes `val validate` runs,
 * offered where the problem is.
 */

const { s, c } = initVal();
const DIR = "/public/val/videos";
const SET = "/content/videos.val.ts" as ModuleFilePath;
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const TINY_MP4 = path.resolve(
  __dirname,
  "../../server/src/__fixtures__/video/tiny.mp4",
);

let valRoot: string;
beforeEach(() => {
  valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-ls-videoset-"));
  fs.mkdirSync(path.join(valRoot, DIR), { recursive: true });
  fs.copyFileSync(TINY_MP4, path.join(valRoot, DIR, "clip_abcde.mp4"));
});
afterEach(() => {
  fs.rmSync(valRoot, { recursive: true, force: true });
});

/** A module as the language server holds it, validated as `val validate` does. */
function contentOf(
  moduleFilePath: ModuleFilePath,
  module: Parameters<typeof Internal.getSource>[0],
): ValModuleContent {
  const schema = Internal.getSchema(module);
  const serialized = schema?.["executeSerialize"]();
  if (!schema || !serialized) {
    throw new Error(`No schema for ${moduleFilePath}`);
  }
  const source = Internal.getSource(module);
  const validation = schema["executeValidate"](
    moduleFilePath as string as SourcePath,
    source,
  );
  return {
    path: moduleFilePath as string as SourcePath,
    source,
    schema: serialized,
    errors: validation ? { validation } : false,
  };
}

describe("which video set fixes go where", () => {
  test("the set's directory checks are adjudicated like a gallery's", () => {
    expect(isGalleryCheckFix("videos:check-unique-folder")).toBe(true);
    expect(isGalleryCheckFix("videos:check-all-files")).toBe(true);
  });

  test("metadata and directory sync are local quick fixes", () => {
    expect(isLocalFix("videos:add-metadata")).toBe(true);
    expect(isLocalFix("videos:check-all-files")).toBe(true);
  });

  test("an upload is a command, never an edit", () => {
    expect(isRemoteFix("videos:upload-remote")).toBe(true);
    expect(REMOTE_FIX_COMMANDS["videos:upload-remote"]).toBeDefined();
    expect(isLocalFix("videos:upload-remote")).toBe(false);
  });
});

describe("videos:add-metadata in the editor", () => {
  // Written as the editor has it; the entry has only what a person typed.
  const TEXT = `import { c, s } from "../val.config";

export default c.define(
  "/content/videos.val.ts",
  s.videoset({ dir: "/public/val/videos" }),
  {
    "/public/val/videos/clip_abcde.mp4": { alt: "Mine" },
  },
);
`;

  function setContent(): ValModuleContent {
    // The source as `TEXT` declares it. Built through a deserialized schema:
    // the entry type requires the metadata this test is about adding.
    const schema = Internal.getSchema(
      c.define(SET, s.videoset({ dir: DIR }), {}),
    )?.["executeSerialize"]();
    if (!schema) throw new Error("no schema");
    const source = { [`${DIR}/clip_abcde.mp4`]: { alt: "Mine" } };
    const validation = deserializeSchema(schema)["executeValidate"](
      SET as string as SourcePath,
      source,
    );
    return {
      path: SET as string as SourcePath,
      source,
      schema,
      errors: validation ? { validation } : false,
    };
  }

  test("offers a quick fix that writes what is read from the file at the key", async () => {
    const content = setContent();
    const document = TextDocument.create(
      "file:///videos.val.ts",
      "typescript",
      1,
      TEXT,
    );
    const diagnostics = createValDiagnostics({
      moduleFilePath: SET,
      content,
      text: TEXT,
      valRoot,
    });
    const metadata = diagnostics.filter((d) => {
      const data = d.data as ValDiagnosticData | undefined;
      return data?.fixes?.includes("videos:add-metadata");
    });
    expect(metadata).toHaveLength(1);

    const actions = await createValCodeActions({
      document,
      diagnostics: metadata,
      content,
      valRoot,
      moduleFilePath: SET,
    });
    expect(actions.map((a) => a.title)).toEqual(["Val: add video metadata"]);
    const edits = actions[0].edit?.changes?.[document.uri] ?? [];
    const applied = TextDocument.applyEdits(document, edits);
    expect(applied).toContain('mimeType: "video/mp4"');
    expect(applied).toContain("duration: 1");
    expect(applied).toContain('alt: "Mine"');
  });

  test("a file that is not there is reported as missing, not as missing metadata", () => {
    fs.rmSync(path.join(valRoot, DIR, "clip_abcde.mp4"));
    const diagnostics = createValDiagnostics({
      moduleFilePath: SET,
      content: setContent(),
      text: TEXT,
      valRoot,
    });
    const missing = diagnostics.filter(
      (d) =>
        (d.data as ValDiagnosticData | undefined)?.code ===
        "val/file-not-found",
    );
    expect(missing.map((d) => d.message)).toEqual([
      `File ${path.join(valRoot, DIR, "clip_abcde.mp4")} does not exist`,
    ]);
  });
});

describe("a set-backed video field naming a video the set does not have", () => {
  const videosVal = c.define(SET, s.videoset({ dir: DIR }), {
    [`${DIR}/other_11111.mp4`]: {
      mimeType: "video/mp4",
      width: 64,
      height: 48,
      duration: 1,
      alt: null,
    },
  });
  const pageVal = c.define(PAGE, s.object({ hero: s.video(videosVal) }), {
    hero: { path: `${DIR}/clip_abcde.mp4` },
  });
  const heroPath = `${PAGE}?p="hero"`;

  test("is a membership problem, with the two remedies a gallery has", async () => {
    const setContent = contentOf(SET, videosVal);
    const gallery = galleryMembershipAt({
      sourcePath: heroPath,
      content: contentOf(PAGE, pageVal),
      snapshot: {
        schemas: setContent.schema ? { [SET]: setContent.schema } : {},
        sources: { [SET]: Internal.getSource(videosVal) },
      },
    });
    expect(gallery).toEqual({
      referencedModule: SET,
      dir: DIR,
      path: `${DIR}/clip_abcde.mp4`,
      mediaType: "video",
    });
    if (!gallery) throw new Error("expected a membership problem");

    const setFile = path.join(valRoot, SET);
    fs.mkdirSync(path.dirname(setFile), { recursive: true });
    fs.writeFileSync(
      setFile,
      `export default c.define("/content/videos.val.ts", s.videoset({ dir: "${DIR}" }), {});\n`,
    );
    const actions = await createGalleryMembershipActions({
      document: TextDocument.create("file:///page.val.ts", "typescript", 1, ""),
      gallery,
      valRoot,
      read: () => undefined,
      allowRename: true,
    });
    expect(actions.map((a) => a.title)).toEqual([
      "Val: add clip_abcde.mp4 to the video set",
    ]);
    const edit: TextEdit | undefined = Object.values(
      actions[0].edit?.changes ?? {},
    )[0]?.[0];
    expect(edit?.newText).toContain(
      `"${DIR}/clip_abcde.mp4": { mimeType: "video/mp4", width: 64, height: 48, duration: 1, alt: null }`,
    );
  });
});
