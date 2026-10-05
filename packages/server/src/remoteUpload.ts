import path from "path";
import {
  Internal,
  SerializedFileSchema,
  SerializedImageSchema,
  SerializedVideoSchema,
} from "@valbuild/core";
import type { FixHandlerContext, FixHandlerResult } from "./fixHandlers";
import { getFileExt } from "./getFileExt";
import {
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
} from "./personalAccessTokens";

const textEncoder = new TextEncoder();

/**
 * Everything an upload to Val Remote needs before it has any bytes: the
 * developer's token, the project's public id and a bucket. Opened once per
 * fix, so a video's dozen files go up under one session and into one bucket
 * rather than a bucket each.
 */
export type RemoteUploadSession = {
  pat: string;
  projectName: string;
  publicProjectId: string;
  bucket: string;
  remoteFileBuckets: string[];
  remoteFilesCounter: number;
};

export async function openRemoteUploadSession(
  ctx: FixHandlerContext,
): Promise<
  | { success: true; session: RemoteUploadSession }
  | { success: false; result: FixHandlerResult }
> {
  const fail = (errorMessage: string) => ({
    success: false as const,
    result: { success: false, errorMessage },
  });
  const patFile = getPersonalAccessTokenPath(ctx.projectRoot);
  if (!ctx.fs.fileExists(patFile)) {
    return fail(
      `File: ${path.join(ctx.projectRoot, ctx.file)} has remote files that are not uploaded and you are not logged in.\n\nFix this error by logging in:\n\t"npx val login"\n`,
    );
  }

  const patFileContent = ctx.fs.readFile(patFile);
  if (patFileContent === undefined) {
    return fail(`Could not read personal access token file at ${patFile}`);
  }

  const parsedPatFile = parsePersonalAccessTokenFile(patFileContent);
  if (!parsedPatFile.success) {
    return fail(
      `Error parsing personal access token file: ${parsedPatFile.error}. You need to login again.`,
    );
  }
  const { pat } = parsedPatFile.data;

  const projectName = ctx.project;
  let publicProjectId = ctx.publicProjectId;
  let remoteFileBuckets = ctx.remoteFileBuckets;
  let remoteFilesCounter = ctx.remoteFilesCounter;

  if (!publicProjectId || !remoteFileBuckets) {
    if (!projectName) {
      return fail(
        "Project name not found. Add project name to val.config or set the VAL_PROJECT environment variable",
      );
    }
    const settingsRes = await ctx.remote.getSettings(projectName, { pat });
    if (!settingsRes.success) {
      return fail(`Could not get public project id: ${settingsRes.message}.`);
    }
    publicProjectId = settingsRes.data.publicProjectId;
    remoteFileBuckets = settingsRes.data.remoteFileBuckets.map((b) => b.bucket);
  }

  if (!publicProjectId) {
    return fail("Could not get public project id");
  }

  if (!projectName) {
    return fail(
      `Could not get project. Check that your val.config has the 'project' field set, or set it using the VAL_PROJECT environment variable`,
    );
  }

  remoteFilesCounter += 1;
  const bucket =
    remoteFileBuckets[remoteFilesCounter % remoteFileBuckets.length];

  if (!bucket) {
    return fail(
      `Internal error: could not allocate a bucket for the remote file located at ${ctx.sourcePath}`,
    );
  }
  return {
    success: true,
    session: {
      pat,
      projectName,
      publicProjectId,
      bucket,
      remoteFileBuckets,
      remoteFilesCounter,
    },
  };
}

/**
 * Upload one file's bytes and return the ref they are served at.
 *
 * `relativeFilePath` is the file's path under the project (`public/...`),
 * which the ref encodes; the bytes need not be the bytes on disk there — a
 * video's playlists are uploaded REWRITTEN, naming the refs of what they list.
 */
export async function uploadBytesToRemote(
  ctx: FixHandlerContext,
  session: RemoteUploadSession,
  relativeFilePath: string,
  fileBuffer: Buffer,
  metadata: Record<string, unknown> | undefined,
  schema: SerializedImageSchema | SerializedFileSchema | SerializedVideoSchema,
): Promise<{ success: true; ref: string } | { success: false; error: string }> {
  if (!relativeFilePath.startsWith("public/")) {
    return {
      success: false,
      error: `File path must be within the public/ directory (e.g. public/path/to/file.txt). Got: ${relativeFilePath}`,
    };
  }
  const fileHash = Internal.remote.getFileHash(fileBuffer);
  const coreVersion = Internal.VERSION.core || "unknown";
  const fileExt = getFileExt(relativeFilePath);
  const ref = Internal.remote.createRemoteRef(ctx.remote.remoteHost, {
    publicProjectId: session.publicProjectId,
    coreVersion,
    bucket: session.bucket,
    validationHash: Internal.remote.getValidationHash(
      coreVersion,
      schema,
      fileExt,
      metadata,
      fileHash,
      textEncoder,
    ),
    fileHash,
    filePath: relativeFilePath as `public/${string}`,
  });

  const remoteFileUpload = await ctx.remote.uploadFile(
    session.projectName,
    session.bucket,
    fileHash,
    fileExt,
    fileBuffer,
    { pat: session.pat },
  );

  if (!remoteFileUpload.success) {
    return {
      success: false,
      error: `Could not upload remote file: '${ref}'. Error: ${remoteFileUpload.error}`,
    };
  }
  return { success: true, ref };
}
