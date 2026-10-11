import {
  DEFAULT_VAL_REMOTE_HOST,
  FileSource,
  Internal,
  MediaSource,
  ModuleFilePath,
  SourcePath,
  ValidationError,
  ValidationFix,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { isStudioFix } from "@valbuild/shared/internal";
import { createFixPatch, FixPatchRemainingError } from "./createFixPatch";
import { extractVideoMetadata } from "./extractMetadata";
import type { FixFiles } from "./fixFiles";
import type { HeadRemoteFile, RemoteHostProblem } from "./remoteFileCheck";
import {
  getFieldsForType,
  type PatchAnalysis,
  type Schemas,
  type Sources,
  type ValOps,
} from "./ValOps";

/**
 * The Studio's full check, one module at a time: what `/validate` and
 * `/validate/fix` answer with. See `docs/plans/studio-validate.md`.
 *
 * Both take the sources the caller is looking at — base plus the patches it
 * names — so an error is about the content on the editor's screen, and a fix
 * is a patch on top of it.
 */
export type StudioCheckInput = {
  moduleFilePath: ModuleFilePath;
  schemas: Schemas;
  sources: Sources;
  fileLastUpdatedByPatchId: PatchAnalysis["fileLastUpdatedByPatchId"];
  /** How a remote host is asked about a ref. Tests replace it. */
  head?: HeadRemoteFile;
};

export type StudioModuleCheck =
  | {
      status: "ok";
      errors: Record<SourcePath, ValidationError[]>;
      /** Hosts that did not serve this module's remote files. */
      remoteHosts: RemoteHostProblem[];
    }
  | { status: "unknown-module" }
  | { status: "invalid-source"; message: string };

/**
 * Every error in one module: its sources against its schema, and its local
 * files against their bytes.
 *
 * Not filtered the way the publish gate filters (`partitionValidationErrors`):
 * the errors the gate hides because "the server repairs them on save" are the
 * ones this check exists to show, since nothing repairs them in http mode.
 *
 * Remote files are checked too: a stale ref is an error with a fix, and a
 * host that does not serve them is reported once, as a host, rather than as
 * an error on every image it holds (`checkRemoteFiles`).
 *
 * Not yet here: the media directories' own entries, step 5 of the plan.
 */
export async function checkModuleForStudio(
  ops: ValOps,
  input: StudioCheckInput,
): Promise<StudioModuleCheck> {
  const { moduleFilePath, schemas, sources } = input;
  if (!schemas[moduleFilePath]) {
    return { status: "unknown-module" };
  }
  const validation = await ops.validateSources(schemas, sources, undefined, [
    moduleFilePath,
  ]);
  const moduleErrors = validation.errors[moduleFilePath];
  if (moduleErrors?.invalidSource) {
    return {
      status: "invalid-source",
      message: moduleErrors.invalidSource.message,
    };
  }
  const errors: Record<SourcePath, ValidationError[]> = {};
  const add = (sourcePath: SourcePath, found: ValidationError[]) => {
    errors[sourcePath] = (errors[sourcePath] ?? []).concat(found);
  };
  for (const [sourcePath, found] of Object.entries(
    moduleErrors?.validations ?? {},
  )) {
    add(sourcePath as SourcePath, found);
  }
  // `validateSources` hands back every local file whose metadata it could
  // not judge without the bytes — which is every image that has metadata at
  // all. Reading them is what turns "has metadata" into "has the RIGHT
  // metadata".
  const fileErrors = await ops.validateFiles(
    schemas,
    sources,
    validation.files,
    input.fileLastUpdatedByPatchId,
  );
  for (const [sourcePath, found] of Object.entries(fileErrors)) {
    add(sourcePath as SourcePath, found);
  }
  const remote = await ops.validateRemoteFiles(
    schemas,
    sources,
    validation.remoteFiles,
    input.fileLastUpdatedByPatchId,
    input.head,
  );
  for (const [sourcePath, found] of Object.entries(remote.errors)) {
    add(sourcePath as SourcePath, found);
  }
  return { status: "ok", errors, remoteHosts: remote.hosts };
}

export type StudioFixResult =
  | {
      status: "ok";
      patch: Patch;
      remainingErrors: FixPatchRemainingError[];
    }
  | { status: "unknown-module" }
  | { status: "not-in-studio" }
  | { status: "not-found" };

/**
 * The patch that fixes one error, built from the server's own reading of the
 * module rather than from the error the caller saw.
 *
 * The caller names the error by where it is and which fix it wants; the error
 * itself is found again here. That is what keeps a stale or hand-written
 * request from steering `createFixPatch` (CLAUDE.md, "Adding a ValidationFix
 * code"), and it is what lets an error reported at a FIELD be fixed at the
 * media value it belongs to: `validateFiles` reports a wrong width at
 * `…"hero"."width"`, while the fix rewrites `…"hero"`.
 *
 * Only {@link isStudioFix} codes are built. The others need a disk or a
 * remote host this server may not have, and are the CLI's for now.
 */
export async function fixForStudio(
  ops: ValOps,
  input: StudioCheckInput & { sourcePath: SourcePath; fix: ValidationFix },
): Promise<StudioFixResult> {
  const { moduleFilePath, schemas, sources, fix } = input;
  if (!isStudioFix(fix)) {
    return { status: "not-in-studio" };
  }
  const schema = schemas[moduleFilePath];
  if (!schema) {
    return { status: "unknown-module" };
  }
  const validation = await ops.validateSources(schemas, sources, undefined, [
    moduleFilePath,
  ]);
  const found = await findError(
    ops,
    validation.errors[moduleFilePath]?.validations ?? {},
    validation.files,
    validation.remoteFiles,
    input,
  );
  if (!found) {
    return { status: "not-found" };
  }
  const res = await createFixPatch(
    {
      // Nothing a Studio fix runs reads `projectRoot`: every byte goes through
      // `files`. An empty root means a fix that slipped past that fails to
      // find its file rather than reading one off this server's disk.
      projectRoot: "",
      // A re-derived ref stays on the host it was on. Moving refs to another
      // host is its own fix (step 6 of the plan), not a side effect of this.
      remoteHost: found.remoteHost ?? DEFAULT_VAL_REMOTE_HOST,
      files: opsFixFiles(ops, input.fileLastUpdatedByPatchId),
    },
    true,
    found.sourcePath,
    found.error,
    {},
    sources[moduleFilePath],
    schema["executeSerialize"](),
  );
  if (!res) {
    return { status: "not-found" };
  }
  return {
    status: "ok",
    patch: res.patch,
    remainingErrors: res.remainingErrors,
  };
}

async function findError(
  ops: ValOps,
  validations: Record<SourcePath, ValidationError[]>,
  files: Record<SourcePath, FileSource>,
  remoteFiles: Record<SourcePath, MediaSource>,
  input: StudioCheckInput & { sourcePath: SourcePath; fix: ValidationFix },
): Promise<
  | { sourcePath: SourcePath; error: ValidationError; remoteHost?: string }
  | undefined
> {
  const { sourcePath, fix } = input;
  const reported = validations[sourcePath]?.find((error) =>
    error.fixes?.includes(fix),
  );
  if (reported) {
    return { sourcePath, error: reported };
  }
  if (fix === "image:check-remote" || fix === "file:check-remote") {
    // Every remote value is in `remoteFiles`, sound or not, so ask whether
    // this one is stale before rewriting it: a ref someone already fixed is
    // "not found", not a download and an identical ref.
    const value = remoteFiles[sourcePath];
    if (!value) {
      return undefined;
    }
    const checked = await ops.validateRemoteFiles(
      input.schemas,
      input.sources,
      { [sourcePath]: value },
      input.fileLastUpdatedByPatchId,
      input.head,
    );
    const stale = checked.errors[sourcePath]?.find((error) =>
      error.fixes?.includes(fix),
    );
    const parsed = Internal.remote.splitRemoteRef(value.path);
    if (!stale || parsed.status === "error") {
      return undefined;
    }
    return { sourcePath, error: stale, remoteHost: parsed.remoteHost };
  }
  if (fix !== "image:check-metadata" && fix !== "file:check-metadata") {
    return undefined;
  }
  // A metadata mismatch is reported by `validateFiles`, at the field that is
  // wrong, and always as `image:check-metadata` — even for a file, which has
  // no width to read. So the media value is found from the field, and the fix
  // is chosen by what its schema says it is.
  for (const [mediaPathS, value] of Object.entries(files)) {
    const mediaPath = mediaPathS as SourcePath;
    const type = mediaTypeAt(mediaPath, input);
    if (!type) {
      continue;
    }
    const fieldPaths = getFieldsForType(type).map((field) =>
      Internal.createValPathOfItem(mediaPath, field),
    );
    if (mediaPath === sourcePath || fieldPaths.includes(sourcePath)) {
      // Every image with metadata is in `files`, right or wrong — being there
      // only means "not yet compared with its bytes". So compare it, and fix
      // only one that is actually wrong: a stale request for an image someone
      // has since fixed is "not found", not an empty patch.
      const mismatches = await ops.validateFiles(
        input.schemas,
        input.sources,
        { [mediaPath]: value },
        input.fileLastUpdatedByPatchId,
      );
      if (Object.keys(mismatches).length === 0) {
        return undefined;
      }
      return {
        sourcePath: mediaPath,
        error: {
          message: "Metadata does not match the file",
          value,
          fixes: [
            type === "image" ? "image:check-metadata" : "file:check-metadata",
          ],
        },
      };
    }
  }
  return undefined;
}

function mediaTypeAt(
  sourcePath: SourcePath,
  { moduleFilePath, schemas, sources }: StudioCheckInput,
): "image" | "file" | undefined {
  const schema = schemas[moduleFilePath];
  if (!schema) {
    return undefined;
  }
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  try {
    const { schema: atPath } = Internal.resolvePath(
      modulePath,
      sources[moduleFilePath],
      schema["executeSerialize"](),
    );
    return atPath.type === "image" || atPath.type === "file"
      ? atPath.type
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * {@link FixFiles} over whatever store this server has: the disk in fs mode,
 * the content service in http mode. A file a pending patch wrote is read from
 * that patch, as `validateFiles` reads it, so a fix is made from the bytes
 * the check was made from.
 */
export function opsFixFiles(
  ops: ValOps,
  fileLastUpdatedByPatchId: PatchAnalysis["fileLastUpdatedByPatchId"],
): FixFiles {
  const readFile = async (filePath: string) => {
    const fromPatch = fileLastUpdatedByPatchId[filePath];
    const buffer = fromPatch
      ? await ops.getBase64EncodedBinaryFileFromPatch(
          filePath,
          fromPatch.patchId,
          fromPatch.remote,
        )
      : await ops.getBinaryFile(filePath);
    if (buffer === null) {
      throw new Error(`Could not read ${filePath}`);
    }
    return buffer;
  };
  return {
    readFile,
    readVideoMetadata: async (filePath) =>
      extractVideoMetadata(filePath, await readFile(filePath)),
    readRemoteFile: readRemoteFileOverHttp,
    saveRemoteFile: async () => ({
      status: "error",
      error:
        "Downloading a remote file is not available in the Studio yet. Run `val validate --fix` in the project.",
    }),
  };
}

/**
 * A remote file's bytes, downloaded and kept nowhere: this server may have no
 * disk to keep them on (http mode, a Worker on the platform).
 */
const readRemoteFileOverHttp: FixFiles["readRemoteFile"] = async (ref) => {
  try {
    const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return {
        status: "error",
        error: `The file could not be downloaded from its address: HTTP ${res.status}.`,
      };
    }
    const fileBuffer = Buffer.from(await res.arrayBuffer());
    return {
      status: "success",
      fileBuffer,
      fileHash: Internal.remote.getFileHash(fileBuffer),
    };
  } catch (err) {
    return {
      status: "error",
      error: `The file could not be downloaded from its address: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }
};
