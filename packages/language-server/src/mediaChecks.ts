/**
 * Adjudicating the media placeholders core emits unconditionally.
 *
 * A media schema cannot answer two of its own questions, because both need
 * something core has no access to -- the bytes on disk, or the bytes on the
 * content host. So it defers, by reporting an error that only means "nobody
 * has looked yet":
 *
 *  - **Metadata.** Any `s.image()` carrying metadata gets an
 *    `image:check-metadata` error whether or not anything is wrong
 *    (`packages/core/src/schema/image.ts`), and `s.file()` does the same with
 *    `file:check-metadata`.
 *  - **Remote refs.** Every `s.image().remote()` / `s.file().remote()` value
 *    whose path is a remote ref gets `Remote image was not checked.` with
 *    `image:check-remote` -- unconditionally, for every remote image in the
 *    project.
 *
 * `val validate` resolves both by running the fix handler and then
 * `createFixPatch` in report mode, which returns one error per real problem
 * and nothing at all when there is none. The Studio cannot do that -- a
 * browser has neither the filesystem nor the project's remote credentials --
 * so it drops them wholesale (`partitionValidationErrors` in
 * `@valbuild/shared`).
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
import { createFixPatch } from "@valbuild/server";
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

/**
 * The fixes that carry an unconditional remote-ref placeholder.
 *
 * The plural `images:check-remote` / `files:check-remote` are deliberately
 * absent. `RecordSchema.validateMediaKey` emits those only for a key that is
 * already wrong -- an unparseable remote URL, or one outside the gallery's
 * directory -- and their messages say so. They are findings, not deferrals,
 * and `createFixPatch` has no branch for them at all, so adjudicating one
 * would come back empty and silently drop a real error.
 */
const REMOTE_CHECK_FIXES: readonly string[] = [
  "image:check-remote",
  "file:check-remote",
];

/** One thing about a media value that a real check found to be wrong. */
export type MediaCheckFinding = {
  message: string;
  /** The placeholder's own fixes, so the quick fix and severity survive. */
  fixes?: ValidationFix[];
  /** The placeholder's `value`, which `createFixPatch` reads. */
  value?: unknown;
};

/**
 * The verdict on one placeholder. Empty means the check passed -- the metadata
 * agrees with the file, or the remote ref is sound -- and nothing should be
 * published.
 */
export type MediaCheckVerdict = MediaCheckFinding[];

/**
 * Whether this error is the unconditional remote-ref deferral.
 *
 * Unlike the metadata deferral this needs no re-derivation: `image:check-remote`
 * is attached to exactly one error in `ImageSchema.executeValidate`, the
 * fall-through for a remote schema with a remote path, and `FileSchema` mirrors
 * it. Everything else a remote media field can be wrong about carries a
 * different fix (`image:upload-remote`, `image:download-remote`) or none.
 */
export function isDeferredRemoteCheck(error: ValidationError): boolean {
  return (error.fixes ?? []).some((fix) => REMOTE_CHECK_FIXES.includes(fix));
}

/**
 * Whether this error is the unconditional METADATA deferral rather than a real
 * finding.
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
 * `mediaChecks.test.ts` drives real core through all five cases to
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
 * Whether an error in a module is either deferral, resolving the schema the
 * metadata classification needs.
 *
 * Both the adjudicator and `createValDiagnostics` have to make the same call,
 * on the same inputs -- one to decide what to adjudicate, the other to decide
 * what to publish -- so it lives here rather than being written out twice.
 */
export function isDeferredMediaCheckAt({
  sourcePath,
  error,
  content,
}: {
  sourcePath: string;
  error: ValidationError;
  content: ValModuleContent;
}): boolean {
  return (
    isDeferredRemoteCheck(error) ||
    isDeferredMediaMetadataCheck({
      error,
      schema: resolveSchemaAt(sourcePath, content),
    })
  );
}

/**
 * Adjudicate every deferred media placeholder in `validation`.
 *
 * Async, and therefore separate from `createValDiagnostics`, which stays
 * synchronous so it can be tested without a project -- the same split
 * `resolveGalleryChecks` uses. The caller runs this first and passes the
 * result in.
 */
export async function resolveMediaChecks({
  validation,
  content,
  valRoot,
  remoteHost = process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
}: {
  validation: Record<SourcePath, ValidationError[]>;
  content: ValModuleContent;
  valRoot: string;
  remoteHost?: string;
}): Promise<Map<string, MediaCheckVerdict>> {
  const verdicts = new Map<string, MediaCheckVerdict>();
  for (const [sourcePath, errors] of Object.entries(validation) as [
    SourcePath,
    ValidationError[],
  ][]) {
    for (const error of errors) {
      if (!isDeferredMediaCheckAt({ sourcePath, error, content })) {
        continue;
      }
      const key = mediaCheckKey(sourcePath, error);
      try {
        verdicts.set(
          key,
          await adjudicate({ sourcePath, error, content, valRoot, remoteHost }),
        );
      } catch {
        // This runs inside `validate`, which publishes NOTHING if it throws --
        // one bad image would silently clear every Val diagnostic in the file.
        // Keep the placeholder rather than claiming the check passed.
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
export function mediaCheckKey(
  sourcePath: string,
  error: ValidationError,
): string {
  return `${sourcePath}|${(error.fixes ?? []).join(",")}`;
}

/** Keeping the placeholder: what to publish when we learned nothing. */
function keep(error: ValidationError): MediaCheckVerdict {
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
 * Which placeholder decides only what has to be true before asking; the asking
 * is the same call either way, and `reportFixPatch` is it.
 */
async function adjudicate(args: {
  sourcePath: SourcePath;
  error: ValidationError;
  content: ValModuleContent;
  valRoot: string;
  remoteHost: string;
}): Promise<MediaCheckVerdict> {
  return isDeferredRemoteCheck(args.error)
    ? adjudicateRemote(args)
    : adjudicateMetadata(args);
}

/**
 * The metadata placeholder: does the stored width/height/mimeType match the
 * bytes?
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
 * the CLI's code -- including for bytes it cannot measure, where it reports
 * what `val validate` reports rather than a second opinion of our own.
 *
 * `createFixPatch` reads and decodes the image itself, so this is one file read
 * per media field per validation pass, and nothing here should add another.
 */
async function adjudicateMetadata({
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
}): Promise<MediaCheckVerdict> {
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
  const reported = await reportFixPatch({
    sourcePath,
    error,
    content,
    valRoot,
    remoteHost,
  });
  if (reported === undefined) {
    return keep(error);
  }
  return reported.map((remaining) => ({
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
 * The remote-ref placeholder: is the ref this value carries still the ref the
 * bytes behind it produce?
 *
 * `handleRemoteFileCheck` is a no-op that asks for the patch, so unlike the
 * metadata case there is no precondition of its own to stand in for -- the
 * whole check is `checkRemoteRef` inside `createFixPatch`. It recomputes the
 * validation hash from the schema, the file extension, the metadata on the
 * value and the file hash in the ref; when that agrees with the ref, nothing is
 * downloaded and nothing is reported. Only a ref that no longer adds up costs a
 * download, and that is cached under `.val/remote-file-cache`.
 *
 * The findings deliberately carry no `fixes`. `createFixPatch` clears them
 * (`Remote ref: ... is not valid. Use the --fix flag to fix this issue.`
 * arrives with `fixes: undefined`), no quick fix is registered for
 * `image:check-remote` -- rewriting the ref needs the bytes off the content
 * host, so it is `val validate --fix`'s job, not a lightbulb's -- and dropping
 * them is what makes this an Error rather than a Warning, matching the `✘` the
 * CLI prints for the same finding.
 */
async function adjudicateRemote({
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
}): Promise<MediaCheckVerdict> {
  const reported = await reportFixPatch({
    sourcePath,
    error,
    content,
    valRoot,
    remoteHost,
  });
  if (reported === undefined) {
    return keep(error);
  }
  return reported.map((remaining) => ({
    message: remaining.message,
    ...(error.value !== undefined ? { value: error.value } : {}),
  }));
}

/**
 * `createFixPatch` in report mode, or `undefined` if it could not answer.
 *
 * `false` is the load-bearing argument: this is a question, not a fix. Asking
 * for the patch would have `createFixPatch` read and rewrite files behind the
 * editor's back -- and, for a remote ref, re-derive one from bytes it had to
 * download first.
 */
async function reportFixPatch({
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
}): Promise<ValidationError[] | undefined> {
  try {
    const fixed = await createFixPatch(
      { projectRoot: valRoot, remoteHost },
      false,
      sourcePath,
      error,
      {},
      content.source,
      content.schema,
    );
    return fixed?.remainingErrors ?? [];
  } catch {
    return undefined;
  }
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
