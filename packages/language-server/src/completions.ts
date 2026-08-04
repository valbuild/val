import fs from "fs";
import ts from "typescript";
import { extractFileMetadata, extractImageMetadata } from "@valbuild/server";
import {
  CompletionItem,
  CompletionItemKind,
  type Range,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { getValCompletionContext } from "./completionContext";
import type { PublicValFiles } from "./publicValFiles";

/**
 * Completions for file and image references.
 *
 * Offers the files that actually exist under the project's files directory, and
 * — when the item is accepted — fills in the metadata argument by reading the
 * chosen file. Getting width/height/mimeType right by hand is tedious and a
 * frequent source of the very validation errors this server reports.
 */

/** Stashed on the item so `resolve` can do the expensive work lazily. */
export type ValCompletionItemData = {
  kind: "file-ref";
  uri: string;
  /** Val-style ref of the chosen file. */
  ref: string;
  /** Absolute path of the chosen file. */
  filePath: string;
  subType: "image" | "file";
  /** Where a metadata argument goes, or what it replaces. */
  refArgEnd: number;
  metadataStart?: number;
  metadataEnd?: number;
};

export function createValCompletions({
  document,
  offset,
  files,
}: {
  document: TextDocument;
  offset: number;
  files: PublicValFiles;
}): CompletionItem[] {
  const sourceFile = ts.createSourceFile(
    document.uri,
    document.getText(),
    ts.ScriptTarget.ES2020,
  );
  const context = getValCompletionContext(sourceFile, offset);
  if (!context) {
    return [];
  }

  // `c.image()` only accepts images; `c.file()` accepts anything.
  const candidates =
    context.subType === "image" ? files.images() : files.list();

  // Replace the whole string contents rather than inserting at the cursor, so
  // completing over an existing path does not concatenate the two.
  const replaceRange: Range = {
    start: document.positionAt(context.contentStart),
    end: document.positionAt(context.contentEnd),
  };

  return candidates.map((file, index) => {
    const data: ValCompletionItemData = {
      kind: "file-ref",
      uri: document.uri,
      ref: file.ref,
      filePath: file.filePath,
      subType: context.subType,
      refArgEnd: context.refArgEnd,
      ...(context.metadataStart !== undefined
        ? {
            metadataStart: context.metadataStart,
            metadataEnd: context.metadataEnd,
          }
        : {}),
    };
    return {
      label: file.ref,
      kind: CompletionItemKind.File,
      detail: file.mimeType,
      textEdit: { range: replaceRange, newText: file.ref },
      // Preserve directory ordering rather than letting the client sort
      // alphabetically on the full path.
      sortText: String(index).padStart(5, "0"),
      data,
    };
  });
}

/**
 * Fill in the metadata argument for an accepted file reference.
 *
 * Done at resolve time because it reads the file from disk, and an editor
 * requests completions far more often than it accepts one.
 */
export async function resolveValCompletion({
  item,
  documents,
}: {
  item: CompletionItem;
  documents: { get(uri: string): TextDocument | undefined };
}): Promise<CompletionItem> {
  const data = item.data as ValCompletionItemData | undefined;
  if (data?.kind !== "file-ref") {
    return item;
  }
  const document = documents.get(data.uri);
  if (!document) {
    return item;
  }

  const metadata = await readMetadata(data);
  if (!metadata) {
    return item;
  }

  const edit: TextEdit =
    data.metadataStart !== undefined && data.metadataEnd !== undefined
      ? {
          // Replace an existing metadata argument.
          range: {
            start: document.positionAt(data.metadataStart),
            end: document.positionAt(data.metadataEnd),
          },
          newText: metadata,
        }
      : {
          // Insert one after the reference argument.
          range: {
            start: document.positionAt(data.refArgEnd),
            end: document.positionAt(data.refArgEnd),
          },
          newText: `, ${metadata}`,
        };

  return { ...item, additionalTextEdits: [edit] };
}

/**
 * Read metadata for the chosen file and render it as source.
 *
 * Uses `@valbuild/server`'s extractors, the same ones `val validate --fix` uses,
 * so a completed reference and a fixed one agree.
 */
async function readMetadata(
  data: ValCompletionItemData,
): Promise<string | undefined> {
  try {
    const buffer = fs.readFileSync(data.filePath);
    if (data.subType === "image") {
      const metadata = await extractImageMetadata(data.filePath, buffer);
      if (
        metadata.width === undefined ||
        metadata.height === undefined ||
        !metadata.mimeType
      ) {
        return undefined;
      }
      return `{ width: ${metadata.width}, height: ${metadata.height}, mimeType: ${JSON.stringify(
        metadata.mimeType,
      )} }`;
    }
    const metadata = await extractFileMetadata(data.filePath, buffer);
    if (!metadata.mimeType) {
      return undefined;
    }
    return `{ mimeType: ${JSON.stringify(metadata.mimeType)} }`;
  } catch {
    // An unreadable or unrecognised file just means no metadata to offer.
    return undefined;
  }
}
