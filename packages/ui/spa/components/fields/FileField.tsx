import {
  FileMetadata,
  ImageMetadata,
  FILE_REF_PROP,
  VAL_EXTENSION,
  ConfigDirectory,
  Internal,
  SourcePath,
  FILE_REF_SUBTYPE_TAG,
  SerializedImageSchema,
  SerializedFileSchema,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { FieldSchemaMismatchError } from "../FieldSchemaMismatchError";
import { FieldSourceError } from "../FieldSourceError";
import { ValidationErrors } from "../ValidationError";
import {
  useValConfig,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValProvider";
import { PreviewLoading, PreviewNull } from "../Preview";
import { File, Loader2, SquareArrowOutUpRight } from "lucide-react";
import { readFile } from "../../utils/readFile";
import { Button } from "../designSystem/button";
import { useState } from "react";
import { getFileExt } from "../../utils/getFileExt";
import { useEffect } from "react";

const textEncoder = new TextEncoder();
export async function createFilePatch(
  path: string[],
  data: string | null,
  filename: string | null,
  fileHash: string,
  metadata: FileMetadata | ImageMetadata | undefined,
  subType: "image" | "file",
  remote: {
    publicProjectId: string;
    coreVersion: string;
    bucket: string;
    schema: SerializedImageSchema | SerializedFileSchema;
    remoteHost: string;
  } | null,
  directory: ConfigDirectory = "/public/val",
): Promise<Patch> {
  const newFilePath = Internal.createFilename(
    data,
    filename,
    metadata,
    fileHash,
  );
  if (!newFilePath || !metadata) {
    return [];
  }

  const filePath = `${directory}/${newFilePath}`;
  const remoteFileHash = Internal.remote.hashToRemoteFileHash(fileHash);
  const ref = remote
    ? Internal.remote.createRemoteRef(remote.remoteHost, {
        publicProjectId: remote.publicProjectId,
        coreVersion: remote.coreVersion,
        bucket: remote.bucket,
        validationHash: Internal.remote.getValidationHash(
          remote.coreVersion,
          remote.schema,
          getFileExt(newFilePath),
          metadata,
          remoteFileHash,
          textEncoder,
        ),
        fileHash: remoteFileHash,
        filePath: `${directory.slice(1) as `public/val`}/${newFilePath}`,
      })
    : filePath;
  return [
    {
      value: {
        [FILE_REF_PROP]: ref,
        [VAL_EXTENSION]: remote ? "remote" : "file",
        ...(subType !== "file" ? { [FILE_REF_SUBTYPE_TAG]: subType } : {}),
        metadata,
      },
      op: "replace",
      path,
    },
    {
      value: data,
      metadata,
      op: "file",
      path,
      filePath: ref,
      remote: remote !== null,
    },
  ];
}

export function FileField({ path }: { path: SourcePath }) {
  const type = "file";
  const config = useValConfig();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const remoteFiles = useRemoteFiles();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const [showAsVideo, setShowAsVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { patchPath, addAndUploadPatchWithFileOps } = useAddPatch(path);
  const [progressPercentage, setProgressPercentage] = useState<number | null>(
    null,
  );
  const maybeSourceData = "data" in sourceAtPath && sourceAtPath.data;
  const maybeClientSideOnly =
    sourceAtPath.status === "success" && sourceAtPath.clientSideOnly;
  useEffect(() => {
    if (maybeSourceData) {
      if (maybeSourceData.metadata) {
        // We can't set the url before it is server side (since the we will be loading)
        if (!maybeClientSideOnly) {
          const nextUrl =
            VAL_EXTENSION in maybeSourceData &&
            maybeSourceData[VAL_EXTENSION] === "remote"
              ? Internal.convertRemoteSource({
                  ...maybeSourceData,
                  [VAL_EXTENSION]: "remote",
                }).url
              : Internal.convertFileSource({
                  ...maybeSourceData,
                  [VAL_EXTENSION]: "file",
                }).url;
          setUrl(nextUrl);
          setLoading(false);
        }
      }
    }
  }, [sourceAtPath]);
  useEffect(() => {
    // We want to show video if only video is accepted
    // If source is defined we also show a video if the mimeType is video
    // If the mimeType is set but not a video, we never want to show video
    if (
      schemaAtPath.status === "success" &&
      schemaAtPath.data.type === "file" &&
      schemaAtPath.data.options?.accept?.startsWith("video/")
    ) {
      setShowAsVideo(true);
    }
    if (maybeSourceData) {
      if (typeof maybeSourceData.metadata?.mimeType === "string") {
        if (maybeSourceData.metadata.mimeType.startsWith("video/")) {
          setShowAsVideo(true);
        } else {
          setShowAsVideo(false);
        }
      }
    }
  }, [schemaAtPath, maybeSourceData]);

  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type={type} />
    );
  }
  if (
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (config === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const source = sourceAtPath.data;
  if (source === undefined) {
    return <FieldNotFound path={path} type={type} />;
  }
  const remoteFileUploadDisabled =
    schemaAtPath.data.type === "file" &&
    schemaAtPath.data.remote &&
    remoteFiles.status !== "ready";
  const disabled = remoteFileUploadDisabled;
  const remoteData =
    schemaAtPath.data.remote &&
    remoteFiles.status === "ready" &&
    currentRemoteFileBucket
      ? {
          publicProjectId: remoteFiles.publicProjectId,
          coreVersion: remoteFiles.coreVersion,
          bucket: currentRemoteFileBucket,
          schema: schemaAtPath.data,
          remoteHost: config.remoteHost,
        }
      : null;
  let filePathRef = null;
  if (source?._ref) {
    if (schemaAtPath.data.remote) {
      const splitRemoteRefDataRes = Internal.remote.splitRemoteRef(
        source?._ref,
      );
      if (splitRemoteRefDataRes.status === "success") {
        filePathRef = splitRemoteRefDataRes.filePath;
      }
    } else {
      filePathRef = source?._ref;
    }
  }

  let filename = null;
  if (filePathRef) {
    filename = filePathRef.split("/").slice(-1)[0];
  }
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      {error && (
        <div className="p-4 rounded bg-bg-error-primary text-fg-error-primary">
          {error}
        </div>
      )}
      <div className="grid gap-2">
        {filename && (
          <div className="flex items-center gap-2">
            <div className="text-sm text-fg-secondary">{filename}</div>
            {loading && (
              <Loader2
                className={`animate-spin text-fg-secondary ${
                  loading ? "block" : "hidden"
                }`}
                size={16}
              />
            )}
            {progressPercentage !== null && (
              <div className="text-sm text-fg-secondary">
                {progressPercentage}%
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-4">
          {source &&
            (showAsVideo ? (
              <div className="flex flex-col gap-2">
                <video
                  className="w-full h-auto rounded-lg"
                  controls
                  src={
                    VAL_EXTENSION in source &&
                    source[VAL_EXTENSION] === "remote"
                      ? Internal.convertRemoteSource({
                          ...source,
                          [VAL_EXTENSION]: "remote",
                        }).url
                      : Internal.convertFileSource({
                          ...source,
                          [VAL_EXTENSION]: "file",
                        }).url
                  }
                />
                <Button asChild variant={"secondary"}>
                  <label htmlFor={`file_input:${path}`}>Upload</label>
                </Button>
              </div>
            ) : (
              <>
                <Button asChild variant={"secondary"}>
                  <label htmlFor={`file_input:${path}`}>Upload</label>
                </Button>
                <a
                  className="flex items-center gap-2"
                  target="_blank"
                  rel="noopener noreferrer"
                  download={filename}
                  href={
                    VAL_EXTENSION in source &&
                    source[VAL_EXTENSION] === "remote"
                      ? Internal.convertRemoteSource({
                          ...source,
                          [VAL_EXTENSION]: "remote",
                        }).url
                      : Internal.convertFileSource({
                          ...source,
                          [VAL_EXTENSION]: "file",
                        }).url
                  }
                >
                  <span> Open file</span>
                  <SquareArrowOutUpRight />
                </a>
              </>
            ))}
          <input
            disabled={disabled}
            hidden
            id={`file_input:${path}`}
            type="file"
            accept={schemaAtPath.data.options?.accept}
            onChange={(ev) => {
              readFile(ev).then((res) => {
                const type = "file";
                const prevUrl: string | null = url;
                setUrl(res.src);
                setLoading(true);

                const data = { src: res.src, filename: res.filename };
                let metadata: FileMetadata | undefined;
                if (res.mimeType) {
                  metadata = {
                    mimeType: res.mimeType,
                  };
                }
                setError(null);
                createFilePatch(
                  patchPath,
                  data.src,
                  data.filename ?? null,
                  res.fileHash,
                  metadata,
                  type,
                  remoteData,
                  config.files?.directory,
                )
                  .then((patch) => {
                    setLoading(true);
                    setProgressPercentage(0);
                    addAndUploadPatchWithFileOps(
                      patch,
                      type,
                      (errorMessage) => {
                        setUrl(prevUrl);
                        setError(errorMessage);
                      },
                      (bytesUploaded, totalBytes, currentFile, totalFiles) => {
                        const overallProgress =
                          (bytesUploaded * (currentFile + 1)) /
                          (totalBytes * totalFiles);
                        setProgressPercentage(
                          Math.round(overallProgress * 100),
                        );
                      },
                    ).finally(() => {
                      setProgressPercentage(null);
                      setLoading(false);
                    });
                  })
                  .catch((err) => {
                    console.error("Failed to create file patch", err);
                    setLoading(false);
                    setUrl(prevUrl);
                    setError("Could not upload file. Please try again later");
                  });
                // reset the input value to allow re-uploading the same file
                ev.target.value = "";
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function FilePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "image");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="image" />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <File size={12} />;
}
