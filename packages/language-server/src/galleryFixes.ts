/**
 * The two remedies for a gallery-backed field pointing at something its gallery
 * does not have.
 *
 * Core reports the problem (`packages/core/src/schema/image.ts`) and offers no
 * `ValidationFix`, because neither remedy is a change to the module holding the
 * field:
 *
 *  - **register it** — add an entry to the *gallery* module, keyed by the path,
 *    carrying the metadata read from the file. An edit to another document.
 *  - **move the file** — when the file is on disk but outside the gallery's
 *    directory, move it there and update the path. A file rename plus an edit.
 *
 * Both used to be VS Code commands in the extension, driven by diagnostics the
 * extension computed itself. They are here so that every editor gets them, and
 * so that a change to how galleries work has one place to be reflected.
 */

import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  CodeAction,
  CodeActionKind,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { extractFileMetadata, extractImageMetadata } from "@valbuild/server";
import type { GalleryMembership } from "./diagnostics";
import { pathToUri } from "./uri";

/**
 * Whether the client will honour a file rename inside a `WorkspaceEdit`.
 *
 * A `RenameFile` sent to a client that did not announce `resourceOperations`
 * is silently dropped, which would leave the path rewritten and the file where it
 * was — worse than not offering the fix.
 */
export function canRenameFiles(capabilities: unknown): boolean {
  const workspace = (
    capabilities as
      | {
          workspace?: {
            workspaceEdit?: { resourceOperations?: unknown };
          };
        }
      | undefined
  )?.workspace;
  const operations = workspace?.workspaceEdit?.resourceOperations;
  return Array.isArray(operations) && operations.includes("rename");
}

export async function createGalleryMembershipActions({
  document,
  gallery,
  valRoot,
  read,
  allowRename,
}: {
  document: TextDocument;
  gallery: GalleryMembership;
  valRoot: string;
  /** The editor's view of a file, falling back to disk. */
  read: (fsPath: string) => string | undefined;
  allowRename: boolean;
}): Promise<CodeAction[]> {
  const actions: CodeAction[] = [];
  const absolute = path.join(valRoot, gallery.path);
  const onDisk = fs.existsSync(absolute);

  const register = await createRegisterInGalleryAction({
    gallery,
    valRoot,
    read,
    onDisk,
  });
  if (register) {
    actions.push(register);
  }

  if (allowRename && gallery.directory && onDisk) {
    const move = createMoveIntoGalleryDirectoryAction({
      document,
      gallery,
      valRoot,
    });
    if (move) {
      actions.push(move);
    }
  }

  return actions;
}

/** Add `"<path>": { …metadata }` to the gallery module's record. */
async function createRegisterInGalleryAction({
  gallery,
  valRoot,
  read,
  onDisk,
}: {
  gallery: GalleryMembership;
  valRoot: string;
  read: (fsPath: string) => string | undefined;
  onDisk: boolean;
}): Promise<CodeAction | undefined> {
  if (!onDisk) {
    // Registering a path with no file behind it would trade this diagnostic for
    // a "file does not exist" one.
    return undefined;
  }
  if (gallery.directory && !gallery.path.startsWith(`${gallery.directory}/`)) {
    // Outside the gallery's directory: registering it would break the gallery's
    // own directory check. Moving is the remedy, not registering.
    return undefined;
  }
  const galleryFile = path.join(valRoot, gallery.referencedModule);
  const text = read(galleryFile) ?? readFileOrUndefined(galleryFile);
  if (text === undefined) {
    return undefined;
  }
  const sourceFile = ts.createSourceFile(
    galleryFile,
    text,
    ts.ScriptTarget.ES2020,
    true,
  );
  const insertion = findRecordInsertion(sourceFile);
  if (!insertion) {
    return undefined;
  }
  const metadata = await readMetadataSource(
    path.join(valRoot, gallery.path),
    gallery.mediaType,
  );
  if (!metadata) {
    return undefined;
  }
  const position = sourceFile.getLineAndCharacterOfPosition(
    insertion.insertOffset,
  );
  const entry = `${JSON.stringify(gallery.path)}: { ${metadata} }`;
  const edit: TextEdit = {
    range: { start: position, end: position },
    newText: insertion.hasProperties
      ? `,\n${insertion.indentation}${entry}`
      : `\n${insertion.indentation}${entry}\n${insertion.indentation.slice(2)}`,
  };
  return CodeAction.create(
    `Val: add ${path.posix.basename(gallery.path)} to the gallery`,
    { changes: { [pathToUri(galleryFile)]: [edit] } },
    CodeActionKind.QuickFix,
  );
}

/** Move the file into the gallery's directory, and point the field at it. */
function createMoveIntoGalleryDirectoryAction({
  document,
  gallery,
  valRoot,
}: {
  document: TextDocument;
  gallery: GalleryMembership;
  valRoot: string;
}): CodeAction | undefined {
  const directory = gallery.directory;
  if (!directory || gallery.path.startsWith(`${directory}/`)) {
    return undefined;
  }
  const target = `${directory}/${path.posix.basename(gallery.path)}`;
  if (fs.existsSync(path.join(valRoot, target))) {
    // Something already lives there. Overwriting a different file is not a fix.
    return undefined;
  }
  const range = findPathStringRange(document, gallery.path);
  if (!range) {
    return undefined;
  }
  return {
    title: `Val: move ${path.posix.basename(gallery.path)} into ${directory}`,
    kind: CodeActionKind.QuickFix,
    edit: {
      documentChanges: [
        {
          kind: "rename",
          oldUri: pathToUri(path.join(valRoot, gallery.path)),
          newUri: pathToUri(path.join(valRoot, target)),
        },
        {
          textDocument: { uri: document.uri, version: null },
          edits: [{ range, newText: target }],
        },
      ],
    },
  };
}

/**
 * The range of the `path` string's *contents* in the field being fixed.
 *
 * Located by searching the document text for the path in quotes rather than
 * through the module path map: the map addresses the value, and what has to be
 * replaced is the text inside the quotes.
 */
function findPathStringRange(
  document: TextDocument,
  currentPath: string,
):
  | {
      start: { line: number; character: number };
      end: { line: number; character: number };
    }
  | undefined {
  const text = document.getText();
  for (const quote of ['"', "'"]) {
    const needle = `${quote}${currentPath}${quote}`;
    const at = text.indexOf(needle);
    if (at === -1) {
      continue;
    }
    // A second occurrence means we cannot tell which one the diagnostic is
    // about, and rewriting the wrong one is worse than offering nothing.
    if (text.indexOf(needle, at + 1) !== -1) {
      return undefined;
    }
    return {
      start: document.positionAt(at + 1),
      end: document.positionAt(at + 1 + currentPath.length),
    };
  }
  return undefined;
}

/**
 * Where to insert into the record that is a gallery module's content -- the third
 * argument of its `c.define(...)`.
 */
export function findRecordInsertion(sourceFile: ts.SourceFile): {
  insertOffset: number;
  indentation: string;
  hasProperties: boolean;
} | null {
  let found: {
    insertOffset: number;
    indentation: string;
    hasProperties: boolean;
  } | null = null;

  function visit(node: ts.Node): void {
    if (
      found === null &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "define" &&
      node.arguments.length >= 3
    ) {
      const record = node.arguments[2];
      if (ts.isObjectLiteralExpression(record)) {
        if (record.properties.length > 0) {
          const last = record.properties[record.properties.length - 1];
          const first = record.properties[0];
          const { character } = sourceFile.getLineAndCharacterOfPosition(
            first.getStart(sourceFile),
          );
          found = {
            insertOffset: last.end,
            indentation: " ".repeat(character),
            hasProperties: true,
          };
        } else {
          found = {
            insertOffset: record.getStart(sourceFile) + 1,
            indentation: "    ",
            hasProperties: false,
          };
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return found;
}

/**
 * The metadata for a gallery entry, rendered as source.
 *
 * Read with `@valbuild/server`'s extractors -- the same ones `val validate --fix`
 * and the media-path completion use -- so a registered entry and a fixed one
 * agree. `alt: null` matches what an upload writes.
 */
async function readMetadataSource(
  filePath: string,
  mediaType: "image" | "file",
): Promise<string | undefined> {
  try {
    const buffer = fs.readFileSync(filePath);
    if (mediaType === "image") {
      const metadata = await extractImageMetadata(filePath, buffer);
      if (
        metadata.width === undefined ||
        metadata.height === undefined ||
        !metadata.mimeType
      ) {
        return undefined;
      }
      return `width: ${metadata.width}, height: ${metadata.height}, mimeType: ${JSON.stringify(
        metadata.mimeType,
      )}, alt: null`;
    }
    const metadata = await extractFileMetadata(filePath, buffer);
    if (!metadata.mimeType) {
      return undefined;
    }
    return `mimeType: ${JSON.stringify(metadata.mimeType)}`;
  } catch {
    return undefined;
  }
}

function readFileOrUndefined(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}
