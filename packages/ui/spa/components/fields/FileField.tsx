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
  const { patchPath, addPatch } = useAddPatch(path);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const maybeClientSideOnly =
    sourceAtPath.status === "success" && sourceAtPath.clientSideOnly;
  useEffect(() => {
    if (!maybeClientSideOnly) {
      setLoading(false);
    }
  }, [maybeClientSideOnly]);

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
        <div className="p-4 rounded bg-bg-error-primary text-text-error-primary">
          {error}
        </div>
      )}
      <div className="grid gap-2">
        {filename && (
          <div className="flex items-center gap-2">
            <div className="text-sm text-text-secondary">{filename}</div>
            {loading && (
              <Loader2
                className={`animate-spin text-text-secondary ${
                  loading ? "block" : "hidden"
                }`}
                size={16}
              />
            )}
          </div>
        )}
        <div className="flex items-center gap-4">
          <Button
            asChild
            variant={"ghost"}
            className="cursor-pointer bg-bg-primary hover:bg-bg-secondary_alt"
          >
            <label htmlFor={`img_input:${path}`}>Update</label>
          </Button>
          {source && (
            <a
              className="flex items-center gap-2"
              href={
                VAL_EXTENSION in source && source[VAL_EXTENSION] === "remote"
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
          )}
          <input
            disabled={disabled}
            hidden
            id={`img_input:${path}`}
            type="file"
            accept={schemaAtPath.data.options?.accept}
            onChange={(ev) => {
              setLoading(true);
              readFile(ev).then((res) => {
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
                  "file",
                  remoteData,
                  config.files?.directory,
                )
                  .then((patch) => {
                    addPatch(patch, schemaAtPath.data.type);
                  })
                  .catch((err) => {
                    setLoading(false);
                    console.error("Failed to create file patch", err);
                    setError("Could not upload file. Please try again later");
                  });
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
