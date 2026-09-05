import {
  DEFAULT_VAL_REMOTE_HOST,
  Internal,
  type SerializedFileSchema,
  type SerializedImageSchema,
} from "@valbuild/core";
import {
  getSettings,
  resolveRemoteFileAuth,
  type ValServerConfig,
} from "@valbuild/server";
import { err, type ValToolError } from "../tools";

/**
 * Where a remote image goes, and what its ref has to say.
 *
 * Only one thing here needs the network: a project's `publicProjectId` and its
 * list of buckets, which `getSettings` answers. Everything else is arithmetic
 * over bytes the caller already handed us.
 *
 * And **no credential comes from the MCP caller**, in either mode. The rule is
 * `resolveRemoteFileAuth` in `@valbuild/server`, shared with the Studio's own
 * api routes: the app's api key where there is one, and otherwise — local
 * development — the developer's own `val login` token off disk. That is the
 * same precondition `val validate --fix` has, and the same one the Studio has
 * when it uploads a remote image from a laptop.
 *
 * What this does NOT do is upload anything to the content host. A remote
 * image's bytes go into the patch store like any other pending file, and the
 * push to `remote.val.build` happens at publish, from
 * `ValOpsFS.saveOrUploadFiles(mode: "upload-remote")`. See
 * `docs/plans/mcp-remote-images.md` Part A.
 */

export type RemoteUploadTarget = {
  publicProjectId: string;
  bucket: string;
  coreVersion: string;
  remoteHost: string;
};

/**
 * Resolves the project's remote-file settings, once.
 *
 * Cached for the life of the process because the answer does not move — a
 * project's public id never changes and its bucket list changes when someone
 * adds a bucket, which is not something an agent's upload should pay a network
 * round trip to notice. Held as the promise rather than the value so that two
 * uploads arriving together make one request rather than two.
 */
export type RemoteSettingsLoader = () => Promise<
  | { status: "success"; publicProjectId: string; buckets: string[] }
  | ValToolError
>;

export function createRemoteSettingsLoader(
  options: ValServerConfig,
): RemoteSettingsLoader {
  let inFlight: ReturnType<RemoteSettingsLoader> | null = null;
  return () => {
    if (inFlight === null) {
      inFlight = load(options).then((result) => {
        if (result.status !== "success") {
          // Not cached: a missing `val login` is a thing a developer fixes
          // while the dev server keeps running, and caching the refusal would
          // mean they had to restart it to find out they had.
          inFlight = null;
        }
        return result;
      });
    }
    return inFlight;
  };
}

async function load(
  options: ValServerConfig,
): Promise<Awaited<ReturnType<RemoteSettingsLoader>>> {
  if (!options.project) {
    return err(
      "unsupported",
      "This Val project is not connected to Val Build, so there is nowhere to upload a remote image to. Set `project` in val.config (or the VAL_PROJECT environment variable), or use a schema without `remote: true`.",
    );
  }
  const auth = await resolveRemoteFileAuth(options);
  if (auth.status === "error") {
    return err(
      "forbidden",
      auth.errorCode === "pat-error"
        ? // The CLI's own wording, near enough: this is the same missing file,
          // and someone who has seen it once should recognise it.
          "This project stores its images remotely, and uploading one needs you to be logged in. Run `npx val login` in the project directory, then try again."
        : `Could not work out which credential to upload remote files with: ${auth.message}`,
    );
  }
  const settings = await getSettings(options.project, auth.auth);
  if (!settings.success) {
    return err(
      "internal",
      `Could not read this project's remote file settings: ${settings.message}`,
    );
  }
  const buckets = settings.data.remoteFileBuckets.map((b) => b.bucket);
  if (buckets.length === 0) {
    return err(
      "internal",
      `The project ${options.project} has no remote file buckets configured, so there is nowhere to put a remote image.`,
    );
  }
  return {
    status: "success",
    publicProjectId: settings.data.publicProjectId,
    buckets,
  };
}

/**
 * Which bucket the next remote file goes in.
 *
 * Round-robin from a per-process counter, which is what `val validate --fix`
 * does. It spreads a project's files rather than balancing anything, and the
 * bucket is baked into the ref, so where a given file lands does not matter as
 * long as it is remembered — which the ref does. A restarted server starts the
 * rotation again, and that is fine for the same reason.
 */
let bucketCounter = 0;

export function nextBucket(buckets: string[]): string {
  bucketCounter += 1;
  return buckets[bucketCounter % buckets.length];
}

/** Test seam: the rotation is process-global, so a suite has to be able to reset it. */
export function resetBucketRotation(): void {
  bucketCounter = 0;
}

export async function resolveRemoteUploadTarget(
  loadSettings: RemoteSettingsLoader,
): Promise<{ status: "success"; target: RemoteUploadTarget } | ValToolError> {
  const settings = await loadSettings();
  if (settings.status !== "success") {
    return settings;
  }
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    return err("internal", "Could not get @valbuild/core package version");
  }
  return {
    status: "success",
    target: {
      publicProjectId: settings.publicProjectId,
      bucket: nextBucket(settings.buckets),
      coreVersion,
      // Read the way `val validate --fix` reads it. Deliberately not from
      // `ValConfig`, which has no such field: the remote host is where Val's
      // own file service lives rather than something a project configures, and
      // the env var is the escape hatch for pointing at another one.
      remoteHost: process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
    },
  };
}

/**
 * The remote ref for these bytes, under this schema.
 *
 * The validation hash is the delicate part, and the reason `schema` is a
 * parameter rather than something derived here: it is baked into the ref, and
 * the validator recomputes it from the schema it finds at the path. Hand this
 * the wrong schema and the upload succeeds and then never validates — see
 * `docs/plans/mcp-remote-images.md` Part D, and `remoteImageSchemaFor`, which
 * is where a gallery's synthesized schema comes from.
 */
export function buildRemoteRef(input: {
  target: RemoteUploadTarget;
  bytes: Uint8Array;
  /** `public/...`, with no leading slash — the shape `createRemoteRef` demands. */
  filePath: `public/${string}`;
  fileExt: string;
  metadata: Record<string, unknown> | undefined;
  schema: SerializedImageSchema | SerializedFileSchema;
}): string {
  const { target } = input;
  const fileHash = Internal.remote.getFileHash(Buffer.from(input.bytes));
  return Internal.remote.createRemoteRef(target.remoteHost, {
    publicProjectId: target.publicProjectId,
    coreVersion: target.coreVersion,
    bucket: target.bucket,
    validationHash: Internal.remote.getValidationHash(
      target.coreVersion,
      input.schema,
      input.fileExt,
      input.metadata,
      fileHash,
      new TextEncoder(),
    ),
    fileHash,
    filePath: input.filePath,
  });
}
