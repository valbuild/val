/**
 * Adjudicating the media metadata placeholders core emits unconditionally.
 *
 * `ImageSchema.validate` cannot read bytes, so it never answers "does the
 * stored width/height/mimeType match the file". It defers instead: any
 * `s.image()` carrying metadata gets an `image:check-metadata` error whether
 * or not anything is wrong (`packages/core/src/schema/image.ts`), and
 * `s.file()` does the same with `file:check-metadata`.
 *
 * `val validate` resolves those by running the fix handler and then
 * `createFixPatch` in report mode, which compares each field against the file
 * and returns one error per field that disagrees. The Studio cannot do that at
 * all -- a browser has no filesystem -- so it drops them wholesale
 * (`partitionValidationErrors` in `@valbuild/shared`).
 *
 * An editor is in the CLI's position, not the browser's, and publishing the
 * placeholders raw put a permanent warning on every image in the project. So
 * they are adjudicated here, by the same comparison `val validate` makes, and
 * only a real disagreement is shown.
 */

import fs from "fs";
import path from "path";
import {
  Internal,
  type SourcePath,
  type ValidationError,
  type ValidationFix,
  DEFAULT_VAL_REMOTE_HOST,
} from "@valbuild/core";
import { createFixPatch, extractImageMetadata } from "@valbuild/server";
import type { ValModuleContent } from "./ValProject";

/**
 * The fixes that carry an unconditional metadata placeholder.
 *
 * `*:add-metadata` is deliberately absent: it is emitted only when every
 * metadata field is missing, which needs no adjudication -- there is nothing
 * stored to compare, and the error stands on its own.
 */
const METADATA_CHECK_FIXES: readonly string[] = [
  "image:check-metadata",
  "file:check-metadata",
];

/** One field of a media value that disagrees with the file behind it. */
export type MediaMetadataFinding = {
  message: string;
  /** The placeholder's own fixes, so the quick fix and severity survive. */
  fixes?: ValidationFix[];
  /** The placeholder's `value`, which `createFixPatch` reads. */
  value?: unknown;
};

/**
 * The verdict on one placeholder. Empty means the metadata agrees with the
 * file and nothing should be published.
 */
export type MediaMetadataVerdict = MediaMetadataFinding[];

/**
 * Whether this error is the unconditional deferral rather than a real finding.
 *
 * This is the whole difficulty of the change. `image:check-metadata` is
 * attached to FIVE different image errors, and only the last is a placeholder:
 *
 *  1. `Invalid mime type format`            -- `accept` set, mimeType has no `/`
 *  2. `Mime type mismatch`                  -- `accept` set and not satisfied
 *  3. `Could not determine mime type from file extension`
 *  4. `Mime type and file extension not matching`
 *  5. the fall-through deferral
 *
 * The first four are real: they are about the mime type disagreeing with the
 * schema or with the filename, neither of which reading the file can settle.
 * Adjudicating one of them would find the stored metadata matches the bytes and
 * drop a genuine error -- so they have to be told apart before any file is read.
 *
 * There is no flag on `ValidationError` saying which is which, so the four
 * conditions are re-derived here from the same inputs core used. They are
 * transcribed from `ImageSchema.executeValidate`, in its order, and
 * `mediaMetadataChecks.test.ts` drives real core through all five cases to
 * check that this agrees with it. If core grows a sixth condition, that test is
 * what catches it.
 *
 * `FileSchema` needs none of this: its four equivalent errors carry no `fixes`
 * at all, so `file:check-metadata` is unambiguous. The test pins that too.
 */
export function isDeferredMediaMetadataCheck({
  error,
  schema,
}: {
  /**
   * The error to classify. Its `value` is the media value core validated, and
   * so is what core's conditions are re-derived from -- the same value
   * `createFixPatch` compares against the file, so the classification and the
   * comparison cannot disagree about which image they are talking about.
   */
  error: ValidationError;
  /** The resolved serialized schema, which is where `accept` lives. */
  schema: unknown;
}): boolean {
  const fixes = error.fixes ?? [];
  if (!fixes.some((fix) => METADATA_CHECK_FIXES.includes(fix))) {
    return false;
  }
  if (fixes.includes("file:check-metadata")) {
    return true;
  }
  const value = mediaValueOf(error.value);
  if (typeof value?.path !== "string") {
    // Nothing to re-derive the conditions from. Keep the error: claiming an
    // image is fine on no evidence is the worse failure.
    return false;
  }
  const accept = acceptOf(schema);
  // Core reads `src.mimeType ?? ""`, and every condition below is guarded on
  // it being non-empty, so an absent mimeType passes all four.
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";

  if (accept && mimeType && !mimeType.includes("/")) {
    return false;
  }
  if (
    accept &&
    mimeType &&
    mimeType.includes("/") &&
    !Internal.mimeTypeMatchesAccept(mimeType, accept)
  ) {
    return false;
  }
  const fileMimeType = Internal.filenameToMimeType(value.path);
  if (!fileMimeType) {
    return false;
  }
  if (mimeType && fileMimeType !== mimeType) {
    return false;
  }
  return true;
}

/**
 * {@link isDeferredMediaMetadataCheck} for an error in a module, resolving the
 * schema it needs.
 *
 * Both the adjudicator and `createValDiagnostics` have to make the same call,
 * on the same inputs -- one to decide what to adjudicate, the other to decide
 * what to publish -- so it lives here rather than being written out twice.
 */
export function isDeferredMediaMetadataCheckAt({
  sourcePath,
  error,
  content,
}: {
  sourcePath: string;
  error: ValidationError;
  content: ValModuleContent;
}): boolean {
  return isDeferredMediaMetadataCheck({
    error,
    schema: resolveSchemaAt(sourcePath, content),
  });
}

/**
 * Adjudicate every deferred metadata placeholder in `validation`.
 *
 * Async, and therefore separate from `createValDiagnostics`, which stays
 * synchronous so it can be tested without a project -- the same split
 * `resolveGalleryChecks` uses. The caller runs this first and passes the
 * result in.
 */
export async function resolveMediaMetadataChecks({
  validation,
  content,
  valRoot,
  remoteHost = process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
}: {
  validation: Record<SourcePath, ValidationError[]>;
  content: ValModuleContent;
  valRoot: string;
  remoteHost?: string;
}): Promise<Map<string, MediaMetadataVerdict>> {
  const verdicts = new Map<string, MediaMetadataVerdict>();
  for (const [sourcePath, errors] of Object.entries(validation) as [
    SourcePath,
    ValidationError[],
  ][]) {
    for (const error of errors) {
      if (!isDeferredMediaMetadataCheckAt({ sourcePath, error, content })) {
        continue;
      }
      const key = mediaMetadataCheckKey(sourcePath, error);
      try {
        verdicts.set(
          key,
          await adjudicate({ sourcePath, error, content, valRoot, remoteHost }),
        );
      } catch {
        // This runs inside `validate`, which publishes NOTHING if it throws --
        // one bad image would silently clear every Val diagnostic in the file.
        // Keep the placeholder rather than claiming the metadata is fine.
        verdicts.set(key, keep(error));
      }
    }
  }
  return verdicts;
}

/**
 * Key for one placeholder. A value can in principle carry more than one, so
 * the fix names are part of the key -- as they are for the gallery checks.
 */
export function mediaMetadataCheckKey(
  sourcePath: string,
  error: ValidationError,
): string {
  return `${sourcePath}|${(error.fixes ?? []).join(",")}`;
}

/** Keeping the placeholder: what to publish when we learned nothing. */
function keep(error: ValidationError): MediaMetadataVerdict {
  return [
    {
      message: error.message,
      ...(error.fixes ? { fixes: error.fixes } : {}),
      ...(error.value !== undefined ? { value: error.value } : {}),
    },
  ];
}

/**
 * What `createFixPatch` says about one placeholder, in report mode.
 *
 * `val validate` runs the fix handler first and then `createFixPatch`, but for
 * these four fixes the handler is `handleFileMetadata`, whose whole job is the
 * precondition "the ref resolves and the file is on disk". That precondition is
 * checked directly here instead, for two reasons:
 *
 *  - `createValDiagnostics` already reports a missing file as
 *    `val/file-not-found`, which is a better diagnostic than a metadata
 *    mismatch and is produced before this verdict is consulted.
 *  - `handleFileMetadata` resolves the source path through the module, and that
 *    throws outright for a `.jsonValues()` entry ("Cannot resolve path into a
 *    jsonValues entry until its content is loaded") -- so routing through it
 *    would leave every entry-backed image stuck on the placeholder.
 *
 * The comparison itself is still `createFixPatch`, unchanged, which is the
 * parity that matters: the editor's wording is the CLI's wording because it is
 * the CLI's code.
 */
async function adjudicate({
  sourcePath,
  error,
  content,
  valRoot,
  remoteHost,
}: {
  sourcePath: SourcePath;
  error: ValidationError;
  content: ValModuleContent;
  valRoot: string;
  remoteHost: string;
}): Promise<MediaMetadataVerdict> {
  const ref = mediaValueOf(error.value)?.path;
  if (typeof ref !== "string") {
    return keep(error);
  }
  // A remote ref is a URL and is not expected on disk. Core does not emit these
  // fixes for one, but a stale ref should not be reported as a local mismatch.
  if (Internal.remote.splitRemoteRef(ref).status === "success") {
    return keep(error);
  }
  if (!fs.existsSync(path.join(valRoot, ref))) {
    // Reported as `val/file-not-found` instead; keeping the placeholder here
    // means this verdict never has the last word on a file that is not there.
    return keep(error);
  }
  if (!(await imageBytesAreReadable({ error, valRoot }))) {
    // No fix offered: the only fix available writes what was read from the
    // bytes, and what was read is 0x0. The file is the problem.
    return [
      {
        message:
          `Could not read the image dimensions of '${ref}'. ` +
          `The file may be corrupt or truncated.`,
        ...(error.value !== undefined ? { value: error.value } : {}),
      },
    ];
  }
  let fixed;
  try {
    fixed = await createFixPatch(
      { projectRoot: valRoot, remoteHost },
      // `false`: this is a question, not a fix. Asking for the patch would have
      // createFixPatch read and rewrite files behind the editor's back.
      false,
      sourcePath,
      error,
      {},
      content.source,
      content.schema,
    );
  } catch {
    return keep(error);
  }
  return (fixed?.remainingErrors ?? []).map((remaining) => ({
    message: remaining.message,
    // `createFixPatch` clears `fixes` on the per-field errors it reports, but
    // the fix is still available and still the remedy -- it is what the
    // placeholder was asking for. Carrying the placeholder's own fixes is what
    // keeps the "update image metadata" quick fix offered, and the diagnostic
    // a Warning rather than an Error.
    ...(error.fixes ? { fixes: error.fixes } : {}),
    ...(error.value !== undefined ? { value: error.value } : {}),
  }));
}

/**
 * Whether an image's dimensions can actually be read from its bytes.
 *
 * `extractImageMetadata` reports `width: 0, height: 0` for bytes `image-size`
 * cannot parse, and `createFixPatch` only guards against `undefined` -- so a
 * corrupt or truncated file would otherwise be reported as "Expected: 0", and
 * "fixing" it would write those zeroes into the module. Keep the placeholder
 * instead: something is wrong, and it is not the stored metadata.
 *
 * Only images have dimensions; a file's metadata is its mime type, which is
 * derived from the name and always readable.
 */
async function imageBytesAreReadable({
  error,
  valRoot,
}: {
  error: ValidationError;
  valRoot: string;
}): Promise<boolean> {
  if (!(error.fixes ?? []).includes("image:check-metadata")) {
    return true;
  }
  const value = mediaValueOf(error.value);
  if (typeof value?.path !== "string") {
    return true;
  }
  const dimensions = await readImageDimensions(path.join(valRoot, value.path));
  return (
    dimensions !== undefined && dimensions.width > 0 && dimensions.height > 0
  );
}

/**
 * Image dimensions, cached on the file's identity.
 *
 * Validation is debounced per keystroke and a module can hold many images, so
 * without this every edit re-reads every one of them. `mtimeMs` and `size`
 * together change whenever the bytes do, which is all this has to notice.
 *
 * Read with `@valbuild/server`'s extractor -- the same one `createFixPatch`
 * and the gallery fixes use -- so this cannot disagree with the comparison it
 * is guarding.
 */
const dimensionsCache = new Map<
  string,
  { mtimeMs: number; size: number; width: number; height: number }
>();

async function readImageDimensions(
  filePath: string,
): Promise<{ width: number; height: number } | undefined> {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return undefined;
  }
  const cached = dimensionsCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === stats.mtimeMs &&
    cached.size === stats.size
  ) {
    return { width: cached.width, height: cached.height };
  }
  let metadata;
  try {
    metadata = await extractImageMetadata(filePath, fs.readFileSync(filePath));
  } catch {
    return undefined;
  }
  // `ImageMetadata` types both as optional, and `extractImageMetadata` already
  // substitutes 0 for bytes it could not parse. Treat absent the same way: the
  // caller reads 0 as "not readable".
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  dimensionsCache.set(filePath, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    width,
    height,
  });
  return { width, height };
}

/** Drop cached dimensions. For tests. */
export function clearImageDimensionsCache(): void {
  dimensionsCache.clear();
}

/**
 * The `accept` a media schema declares, if any.
 *
 * Read from the serialized schema (`SerializedImageSchema.options`) rather
 * than from a schema instance: this runs against what `Service.get` returns.
 */
function acceptOf(schema: unknown): string | undefined {
  if (typeof schema !== "object" || schema === null || !("options" in schema)) {
    return undefined;
  }
  const { options } = schema;
  if (
    typeof options !== "object" ||
    options === null ||
    !("accept" in options)
  ) {
    return undefined;
  }
  const { accept } = options;
  return typeof accept === "string" ? accept : undefined;
}

/** A media value, read as a plain record. */
function mediaValueOf(
  value: unknown,
): { path?: unknown; mimeType?: unknown } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

/**
 * The serialized schema at a source path.
 *
 * Only the schema is taken from resolution -- `accept` is not on the value, and
 * the value itself comes from the error. Same call `missingFileRef` in
 * `diagnostics.ts` makes, and it can fail the same ways (a schema that failed
 * to serialize, a path that no longer resolves), so failure is not an error
 * here, just an absence.
 */
function resolveSchemaAt(
  sourcePath: string,
  content: ValModuleContent,
): unknown {
  if (!content.source || !content.schema) {
    return undefined;
  }
  try {
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePath as never,
    );
    return Internal.resolvePath(modulePath, content.source, content.schema)
      .schema;
  } catch {
    return undefined;
  }
}
