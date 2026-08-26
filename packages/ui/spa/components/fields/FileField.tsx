import {
  FileMetadata,
  ImageMetadata,
  FILE_REF_PROP,
  VAL_EXTENSION,
  Internal,
  ModuleFilePath,
  SourcePath,
  FILE_REF_SUBTYPE_TAG,
  SerializedImageSchema,
  SerializedFileSchema,
} from "@valbuild/core";
import { JSONValue, Patch } from "@valbuild/core/patch";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { FieldSchemaMismatchError } from "../FieldSchemaMismatchError";
import { FieldSourceError } from "../FieldSourceError";
import {
  useValConfig,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useFieldCreatorId,
  useSchemas,
  useFilePatchIds,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import { PreviewLoading, PreviewNull } from "../Preview";
import { File, SquareArrowOutUpRight, Upload } from "lucide-react";
import { readFile } from "../../utils/readFile";
import { Button } from "../designSystem/button";
import { useMemo, useRef, useState } from "react";
import { getFileExt } from "../../utils/getFileExt";
import { useEffect } from "react";
import { useValPortal } from "../ValPortalProvider";
import { ModuleMediaPicker } from "../MediaPicker/MediaPicker";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";
import { MediaSummaryRow } from "./MediaSummaryRow";
import { cn } from "../designSystem/cn";
import type { GalleryEntry } from "../MediaPicker/MediaPicker";

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
  directory: string | undefined = "/public/val",
  skipMetadataInReplace: boolean = false,
): Promise<{ patch: Patch; filePath: string }> {
  const newFilePath = Internal.createFilename(
    data,
    filename,
    metadata,
    fileHash,
  );
  if (!newFilePath || !metadata) {
    return { patch: [], filePath: "" };
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
        filePath:
          `${(directory ?? "/public/val").slice(1)}/${newFilePath}` as `public/${string}`,
      })
    : filePath;
  return {
    patch: [
      {
        value: {
          [FILE_REF_PROP]: ref,
          [VAL_EXTENSION]: remote ? "remote" : "file",
          ...(subType !== "file" ? { [FILE_REF_SUBTYPE_TAG]: subType } : {}),
          ...(skipMetadataInReplace ? {} : { metadata }),
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
    ],
    filePath,
  };
}

export function FileField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "file";
  const creatorId = useFieldCreatorId();
  const config = useValConfig();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const remoteFiles = useRemoteFiles();
  const schemas = useSchemas();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type, creatorId);
  const [showAsVideo, setShowAsVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    addPatch,
    patchPath,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  } = useAddPatch(path, creatorId);
  const portalContainer = useValPortal();
  /**
   * The hidden file input, clicked by name.
   *
   * A `<label htmlFor>` would open the dialog without any script, but a label is
   * not announced as a button and cannot be tabbed to as one — and "Choose
   * asset" is the field's primary action.
   */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progressPercentage, setProgressPercentage] = useState<number | null>(
    null,
  );
  const filePatchIds = useFilePatchIds();
  const maybeSourceData = "data" in sourceAtPath && sourceAtPath.data;
  const maybeClientSideOnly =
    sourceAtPath.status === "success" && sourceAtPath.clientSideOnly;
  useEffect(() => {
    if (maybeSourceData) {
      if (maybeSourceData.metadata) {
        // We can't set the url before it is server side (since the we will be loading)
        if (!maybeClientSideOnly) {
          const patchId = filePatchIds.get(maybeSourceData[FILE_REF_PROP]);
          const nextUrl =
            VAL_EXTENSION in maybeSourceData &&
            maybeSourceData[VAL_EXTENSION] === "remote"
              ? Internal.convertRemoteSource({
                  ...maybeSourceData,
                  [VAL_EXTENSION]: "remote",
                  ...(patchId ? { patch_id: patchId } : {}),
                }).url
              : Internal.convertFileSource({
                  ...maybeSourceData,
                  [VAL_EXTENSION]: "file",
                  ...(patchId ? { patch_id: patchId } : {}),
                }).url;
          setUrl(nextUrl);
          setLoading(false);
        }
      }
    }
  }, [sourceAtPath, filePatchIds]);
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

  /**
   * Hooks first, guards after — see the same note in `ImageField`.
   *
   * These two `useMemo`s sat below the `loading` / `not-found` / wrong-type
   * returns, so an `s.file().nullable()` field that nothing has uploaded to yet
   * ran fewer hooks on its first render than on its second and crashed the
   * Studio with "Rendered more hooks than during the previous render".
   */
  const fileSchema =
    schemaAtPath.status === "success" && schemaAtPath.data.type === "file"
      ? schemaAtPath.data
      : undefined;
  const referencedModule = fileSchema?.referencedModule;
  const acceptOptions = useMemo(() => {
    if (!fileSchema || schemas.status !== "success") {
      return undefined;
    }
    if (fileSchema.options?.accept) {
      return fileSchema.options.accept;
    }
    if (!referencedModule) {
      return undefined;
    }
    const moduleSchema = schemas.data[referencedModule as ModuleFilePath];
    if (moduleSchema?.type === "record" && moduleSchema.accept) {
      return moduleSchema.accept;
    }
    return undefined;
  }, [fileSchema, referencedModule, schemas]);
  /**
   * Where an upload from this field is stored: the gallery it references, or
   * `createFilePatch`'s `/public/val` default.
   *
   * Unlike `s.image()`, `FileOptions` has no `directory` — so a standalone
   * `s.file()` cannot choose one. Left as it is rather than added here: that is
   * an API change to `packages/core`, not a fix.
   */
  const uploadDirectory = useMemo(() => {
    if (!referencedModule || schemas.status !== "success") return undefined;
    const moduleSchema = schemas.data[referencedModule as ModuleFilePath];
    return moduleSchema?.type === "record" ? moduleSchema.directory : undefined;
  }, [referencedModule, schemas]);
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
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
  const missingModules =
    referencedModule && schemas.status === "success"
      ? schemas.data[referencedModule as ModuleFilePath]
        ? []
        : [referencedModule]
      : [];
  const disabled =
    readonly || remoteFileUploadDisabled || missingModules.length > 0;
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
  /**
   * What the summary row says under the name.
   *
   * An `s.file()` records only the mime type — no byte size — so that is all
   * there is to say, and it is absent rather than guessed when even that is
   * missing.
   */
  const fileDetail =
    source?.metadata && typeof source.metadata.mimeType === "string"
      ? source.metadata.mimeType
      : null;
  return (
    <div id={path}>
      {missingModules.length > 0 && (
        <div className="p-4 rounded bg-bg-error-primary text-fg-error-primary">
          {missingModules.length === 1
            ? `The module '${missingModules[0]}' is referenced by this field but is not added to val.modules. Add it to val.modules to enable uploads.`
            : `The following modules are referenced by this field but are not added to val.modules: ${missingModules.join(", ")}. Add them to val.modules to enable uploads.`}
        </div>
      )}
      {error && (
        <div className="p-4 rounded bg-bg-error-primary text-fg-error-primary">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-5">
        {/*
         * The same summary row the image field uses: which file, then what can
         * be done with it. A file has no picture to identify it by, so the name
         * and type are the whole answer and used to be a bare line of text with
         * the controls somewhere below.
         */}
        <MediaSummaryRow
          url={url}
          name={filename}
          detail={fileDetail}
          isImage={false}
          uploading={loading}
          progressPercentage={progressPercentage}
          actions={
            <>
              {/*
               * One control for "which file". A field that owns its file opens
               * the dialog directly; one pointing into a collection opens the
               * list, with the upload inside it — choosing a file and adding one
               * to the collection are the same decision from here.
               */}
              {!referencedModule && (
                <Button
                  variant={"outline"}
                  size="sm"
                  disabled={disabled}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {source ? "Replace" : "Choose asset"}
                </Button>
              )}
              {source && (
                <a
                  className="inline-flex items-center gap-1.5 text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
                  target="_blank"
                  rel="noopener noreferrer"
                  download={filename ?? undefined}
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
                  Open file
                  <SquareArrowOutUpRight size={12} />
                </a>
              )}
              {referencedModule && (
                <ModuleMediaPicker
                  compact
                  footer={
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
                        "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
                        "disabled:pointer-events-none disabled:opacity-50",
                      )}
                    >
                      <Upload size={13} />
                      Upload into {prettyModuleName(referencedModule)}
                    </button>
                  }
                  modulePath={referencedModule as ModuleFilePath}
                  selectedRef={source?._ref ?? null}
                  onSelect={(entry: GalleryEntry) => {
                    addPatch(
                      [
                        {
                          op: "replace",
                          path: patchPath,
                          value: {
                            [FILE_REF_PROP]: entry.filePath,
                            [VAL_EXTENSION]: "file",
                            metadata: entry.metadata as JSONValue,
                          },
                        },
                      ],
                      "file",
                    );
                  }}
                  isImage={false}
                  disabled={disabled}
                  portalContainer={portalContainer}
                />
              )}
            </>
          }
        />
        {/* A video is worth showing at size; anything else is a name. */}
        {source && showAsVideo && (
          <video
            className="w-full h-auto rounded-lg"
            controls
            src={
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
          />
        )}
        <div>
          <input
            disabled={disabled}
            hidden
            ref={fileInputRef}
            id={`file_input:${path}`}
            type="file"
            accept={acceptOptions}
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
                  uploadDirectory,
                  !!referencedModule,
                )
                  .then(({ patch, filePath }) => {
                    setLoading(true);
                    setProgressPercentage(0);
                    let hasError = false;
                    addAndUploadPatchWithFileOps(
                      patch,
                      type,
                      (errorMessage) => {
                        hasError = true;
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
                    )
                      .then(() => {
                        if (
                          !hasError &&
                          referencedModule &&
                          filePath &&
                          metadata?.mimeType
                        ) {
                          addModuleFilePatch(
                            referencedModule as ModuleFilePath,
                            [
                              {
                                op: "add",
                                path: [filePath],
                                value: {
                                  mimeType: metadata.mimeType,
                                } as JSONValue,
                              },
                            ],
                            "record",
                          );
                        }
                      })
                      .finally(() => {
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
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <File size={12} />;
}
