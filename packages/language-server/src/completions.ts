import fs from "fs";
import ts from "typescript";
import { Internal, type ModulePath, type SourcePath } from "@valbuild/core";
import {
  getRoutesWithModulePaths,
  type SchemaSourceSnapshot,
} from "@valbuild/shared/internal";
import { extractFileMetadata, extractImageMetadata } from "@valbuild/server";
import {
  CompletionItem,
  CompletionItemKind,
  type Range,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  findFileRefArgument,
  getValCompletionContext,
} from "./completionContext";
import { createModulePathMap, findModulePathAtPosition } from "./modulePathMap";
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
  /**
   * Start offset of the reference argument, used to re-find the call at resolve
   * time. Offsets captured now cannot be replayed later: see
   * {@link findFileRefArgument}.
   */
  refArgStart: number;
};

export function createValCompletions({
  document,
  offset,
  files,
  moduleFilePath,
  snapshot,
}: {
  document: TextDocument;
  offset: number;
  files: PublicValFiles;
  /** This module's path, needed to look its schema up in the snapshot. */
  moduleFilePath?: string;
  /** Project-wide schemas and sources, for schema-driven completions. */
  snapshot?: SchemaSourceSnapshot;
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

  if (context.kind === "string-value") {
    if (!moduleFilePath || !snapshot) {
      return [];
    }
    return createSchemaDrivenCompletions({
      document,
      sourceFile,
      offset,
      moduleFilePath,
      snapshot,
      files,
      isPropertyName: context.isPropertyName,
      valueOfProperty: context.valueOfProperty,
      contentStart: context.contentStart,
      contentEnd: context.contentEnd,
    });
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
      refArgStart: context.refArgStart,
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

  // Re-derive the argument offsets against the document as it is *now*: the user
  // may have typed to filter the list since it was computed, which moves
  // everything after the reference string. `additionalTextEdits` are applied
  // verbatim by the client, so a stale offset here corrupts the file.
  const args = findFileRefArgument(
    ts.createSourceFile(
      data.uri,
      document.getText(),
      ts.ScriptTarget.ES2020,
      false,
      ts.ScriptKind.TS,
    ),
    data.refArgStart,
  );
  if (!args) {
    // The anchor no longer resolves, so there is no safe place to put the
    // metadata. `val validate --fix` and the metadata quick fix still cover it.
    return item;
  }

  const metadata = await readMetadata(data);
  if (!metadata) {
    return item;
  }

  const edit: TextEdit =
    args.metadataStart !== undefined && args.metadataEnd !== undefined
      ? {
          // Replace an existing metadata argument.
          range: {
            start: document.positionAt(args.metadataStart),
            end: document.positionAt(args.metadataEnd),
          },
          newText: metadata,
        }
      : {
          // Insert one after the reference argument.
          range: {
            start: document.positionAt(args.refArgEnd),
            end: document.positionAt(args.refArgEnd),
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

/**
 * Completions whose candidates come from the schema at the cursor.
 *
 * Handles `keyOf` (the keys of the record or object it points at) and `route`
 * (the pages that exist in the project). Both need to look at other modules,
 * hence the snapshot.
 *
 * The schema at the cursor is found by mapping the cursor position back to a
 * module path and resolving the schema there with `Internal.resolvePath`, rather
 * than walking the serialized schema by hand.
 */
function createSchemaDrivenCompletions({
  document,
  sourceFile,
  offset,
  moduleFilePath,
  snapshot,
  files,
  isPropertyName,
  valueOfProperty,
  contentStart,
  contentEnd,
}: {
  document: TextDocument;
  sourceFile: ts.SourceFile;
  offset: number;
  moduleFilePath: string;
  snapshot: SchemaSourceSnapshot;
  files: PublicValFiles;
  isPropertyName: boolean;
  valueOfProperty?: string;
  contentStart: number;
  contentEnd: number;
}): CompletionItem[] {
  const schema = snapshot.schemas[moduleFilePath as never];
  const source = snapshot.sources[moduleFilePath as never];
  if (!schema || source === undefined) {
    return [];
  }

  const modulePathMap = createModulePathMap(sourceFile);
  if (!modulePathMap) {
    return [];
  }
  const modulePath = findModulePathAtPosition(
    modulePathMap,
    document.positionAt(offset),
  );
  if (modulePath === undefined) {
    return [];
  }

  const range: Range = {
    start: document.positionAt(contentStart),
    end: document.positionAt(contentEnd),
  };

  // A key is described by its container, not by itself: a gallery record is
  // keyed by file reference, so the candidates come from the record's schema.
  if (isPropertyName) {
    const container = resolveSchemaAt(
      parentModulePath(modulePath),
      source,
      schema,
    );
    if (
      !container ||
      typeof container !== "object" ||
      !("type" in container) ||
      container.type !== "record" ||
      !("mediaType" in container) ||
      !container.mediaType
    ) {
      return [];
    }
    const directory =
      "directory" in container && typeof container.directory === "string"
        ? container.directory
        : undefined;
    const galleryFiles =
      container.mediaType === "images"
        ? files.images(directory)
        : files.list(directory);
    return items(
      galleryFiles.map((file) => file.ref),
      CompletionItemKind.File,
      range,
    );
  }

  const fieldSchema = resolveSchemaAt(modulePath, source, schema);

  // Checked before the schema is required, because Val describes richtext content
  // as a whole rather than node by node: a link is a plain
  // `{ tag: "a", href: ... }` object, so resolving the href's own path fails and
  // there is no field schema to branch on. Walk out to the enclosing richtext and
  // check that it permits inline links instead.
  if (valueOfProperty === "href") {
    const richtext = findEnclosingRichtext(modulePath, source, schema);
    if (richtext && permitsInlineLinks(richtext)) {
      return routeItems(snapshot, range);
    }
  }

  if (
    !fieldSchema ||
    typeof fieldSchema !== "object" ||
    !("type" in fieldSchema)
  ) {
    return [];
  }

  if (fieldSchema.type === "keyOf") {
    return items(
      keysOfKeyOf(fieldSchema, snapshot),
      CompletionItemKind.EnumMember,
      range,
    );
  }

  if (fieldSchema.type === "route") {
    return routeItems(snapshot, range);
  }

  return [];
}

/** The routes the project defines, as completion items. */
function routeItems(
  snapshot: SchemaSourceSnapshot,
  range: Range,
): CompletionItem[] {
  // The routes that exist are the keys of the project's router modules, which is
  // exactly what getRoutesWithModulePaths reads out of the snapshot.
  const routes = getRoutesWithModulePaths(snapshot.schemas, snapshot.sources);
  return routes.map((route, index) => ({
    label: route.route,
    kind: CompletionItemKind.Value,
    // Say which module defines the page, so an ambiguous route is
    // distinguishable.
    detail: route.moduleFilePath,
    textEdit: { range, newText: route.route },
    sortText: String(index).padStart(5, "0"),
  }));
}

/**
 * Walk out from a module path until a richtext schema is found.
 *
 * Resolving a path *inside* richtext content fails, since Val does not describe
 * individual nodes with schemas, so the walk drops segments until it lands on the
 * richtext field itself.
 */
function findEnclosingRichtext(
  modulePath: ModulePath,
  source: unknown,
  schema: Parameters<typeof Internal.resolvePath>[2],
) {
  let segments = Internal.splitModulePath(modulePath);
  // Tests the cursor's own path first, then walks outwards: the path may already
  // be the richtext field if the cursor is not inside a nested node.
  for (;;) {
    const candidate = resolveSchemaAt(
      Internal.patchPathToModulePath(segments),
      source,
      schema,
    );
    if (
      candidate &&
      typeof candidate === "object" &&
      "type" in candidate &&
      candidate.type === "richtext"
    ) {
      return candidate;
    }
    if (segments.length === 0) {
      return undefined;
    }
    segments = segments.slice(0, -1);
  }
}

/** Whether a richtext schema allows inline `a` links. */
function permitsInlineLinks(richtext: object): boolean {
  if (!("options" in richtext)) {
    return false;
  }
  const options = (richtext as { options?: { inline?: { a?: unknown } } })
    .options;
  // `inline.a` is either `true` or the schema the href must satisfy; both mean
  // links are allowed.
  return Boolean(options?.inline?.a);
}

/** Schema at a module path, or undefined when it cannot be resolved. */
function resolveSchemaAt(
  modulePath: ModulePath,
  source: unknown,
  schema: Parameters<typeof Internal.resolvePath>[2],
) {
  try {
    // Val's own resolver, rather than a hand-rolled serialized-schema walker.
    return Internal.resolvePath(modulePath, source as never, schema).schema;
  } catch {
    return undefined;
  }
}

/** Drop the last segment of a module path; `""` is the module root. */
function parentModulePath(modulePath: ModulePath): ModulePath {
  const segments = Internal.splitModulePath(modulePath);
  return Internal.patchPathToModulePath(segments.slice(0, -1));
}

function items(
  labels: string[],
  kind: CompletionItemKind,
  range: Range,
): CompletionItem[] {
  return labels.map((label, index) => ({
    label,
    kind,
    textEdit: { range, newText: label },
    // Preserve the source ordering rather than letting the client re-sort.
    sortText: String(index).padStart(5, "0"),
  }));
}

function keysOfKeyOf(
  schema: { values?: "string" | string[]; path?: string },
  snapshot: SchemaSourceSnapshot,
): string[] {
  // Object targets serialize their keys directly.
  if (Array.isArray(schema.values)) {
    return schema.values;
  }
  // Record targets say "string"; the keys are whatever the target module holds.
  if (!schema.path) {
    return [];
  }
  try {
    const [targetModuleFilePath, targetModulePath] =
      Internal.splitModuleFilePathAndModulePath(schema.path as SourcePath);
    const targetSchema = snapshot.schemas[targetModuleFilePath];
    const targetSource = snapshot.sources[targetModuleFilePath];
    if (!targetSchema || targetSource === undefined) {
      return [];
    }
    const resolved = Internal.resolvePath(
      targetModulePath as ModulePath,
      targetSource as never,
      targetSchema,
    );
    const value = resolved.source;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    return Object.keys(value);
  } catch {
    return [];
  }
}
