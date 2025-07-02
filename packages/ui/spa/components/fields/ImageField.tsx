import {
  ImageMetadata,
  Internal,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useValConfig,
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { readImage } from "../../utils/readImage";
import { createFilePatch } from "./FileField";
import { ValidationErrors } from "../../components/ValidationError";
import { useEffect, useState } from "react";
import { Input } from "../designSystem/input";
import { Loader2 } from "lucide-react";
import { Button } from "../designSystem/button";

export function ImageField({ path }: { path: SourcePath }) {
  const type = "image";
  const config = useValConfig();
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const [hotspot, setHotspot] = useState<{ y: number; x: number } | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { addPatch, patchPath, addAndUploadPatchWithFileOps } =
    useAddPatch(path);
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
        //
        const metadata = maybeSourceData.metadata;
        if (
          typeof metadata.width !== "number" ||
          typeof metadata.height !== "number"
        ) {
          console.warn(
            `Expected metadata width and height to be numbers but width was: ${typeof metadata.width} and height was: ${typeof metadata.height}`,
          );
          return;
        }
        if ("hotspot" in metadata) {
          if (
            typeof metadata.hotspot === "object" &&
            metadata.hotspot &&
            "x" in metadata.hotspot &&
            "y" in metadata.hotspot
          ) {
            const { x, y } = metadata.hotspot;
            if (typeof x === "number" && typeof y === "number") {
              setHotspot({
                x,
                y,
              });
            } else {
              console.warn(
                `Expected hotspot to have x and y as numbers but x was: ${typeof x} and y: ${typeof y}`,
              );
            }
          }
        } else {
          setHotspot(undefined);
        }
      } else {
        setHotspot(undefined);
      }
    }
  }, [sourceAtPath]);
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
    schemaAtPath.data.type === "image" &&
    schemaAtPath.data.remote &&
    remoteFiles.status !== "ready";
  const disabled = remoteFileUploadDisabled;
  const remoteData =
    schemaAtPath.data.remote &&
    remoteFiles.status === "ready" &&
    currentRemoteFileBucket
      ? {
          publicProjectId: remoteFiles.publicProjectId,
          bucket: currentRemoteFileBucket,
          coreVersion: remoteFiles.coreVersion,
          schema: schemaAtPath.data,
          remoteHost: config.remoteHost,
        }
      : null;
  const metadataPath = Internal.createValPathOfItem(path, "metadata");
  const altPath = Internal.createValPathOfItem(metadataPath, "alt");
  const hotspotPath = Internal.createValPathOfItem(metadataPath, "hotspot");
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      {error && (
        <div className="p-4 rounded bg-bg-error-primary text-fg-error-primary">
          {error}
        </div>
      )}
      {schemaAtPath.data.type === "image" &&
        schemaAtPath.data.remote &&
        remoteFiles.status === "inactive" && (
          <div className="p-4 rounded bg-bg-error-primary text-fg-error-primary">
            {getRemoteFilesError(remoteFiles.reason)}
          </div>
        )}
      <div className="flex flex-col gap-2">
        {source && (
          <div className="">
            <span id={altPath}>Alt text</span>
            <Input
              value={
                source.metadata?.alt
                  ? typeof source.metadata?.alt === "string"
                    ? source.metadata?.alt
                    : ""
                  : ""
              }
              disabled={disabled}
              onChange={(ev) => {
                const alt = ev.target.value;
                if (source.metadata && "alt" in source.metadata) {
                  addPatch(
                    [
                      {
                        op: "replace",
                        value: alt,
                        path: patchPath.concat(["metadata", "alt"]),
                      },
                    ],
                    "string",
                  );
                } else if (source.metadata && !("alt" in source.metadata)) {
                  addPatch(
                    [
                      {
                        op: "add",
                        value: alt,
                        path: patchPath.concat(["metadata", "alt"]),
                      },
                    ],
                    "string",
                  );
                } else if (source.metadata === undefined) {
                  addPatch(
                    [
                      {
                        op: "add",
                        value: {
                          ...(hotspot ? { hotspot } : {}),
                          alt: alt,
                        },
                        path: patchPath.concat(["metadata"]),
                      },
                    ],
                    "object",
                  );
                } else {
                  console.warn(
                    `Expected source.metadata to be an object but got ${typeof source.metadata}`,
                  );
                }
              }}
            />
          </div>
        )}
        {source && url && (
          <div className="relative rounded-lg bg-bg-secondary">
            {loading && (
              <div className="flex absolute inset-0 flex-col justify-center items-center">
                <div className="absolute inset-0 w-full h-full opacity-50 bg-bg-secondary" />
                <Loader2 size={24} className="animate-spin" />
                <div className="mt-2 text-xs font-thin text-[white] z-5">
                  {progressPercentage !== null ? `${progressPercentage}%` : ""}
                </div>
              </div>
            )}
            <img
              src={url}
              draggable={false}
              className="object-contain max-h-[500px] w-full"
              style={{
                cursor: "crosshair",
              }}
              id={hotspotPath}
              onClick={(ev) => {
                const { width, height, left, top } =
                  ev.currentTarget.getBoundingClientRect();
                const hotspot = {
                  x: Math.max((ev.clientX - 6 - left) / width, 0),
                  y: Math.max((ev.clientY - 6 - top) / height, 0),
                };
                if (source.metadata && "hotspot" in source.metadata) {
                  addPatch(
                    [
                      {
                        op: "replace",
                        path: patchPath.concat(["metadata", "hotspot"]),
                        value: hotspot,
                      },
                    ],
                    "object",
                  );
                } else if (source.metadata) {
                  addPatch(
                    [
                      {
                        op: "add",
                        path: patchPath.concat(["metadata", "hotspot"]),
                        value: hotspot,
                      },
                    ],
                    "object",
                  );
                } else if (source.metadata === undefined) {
                  addPatch(
                    [
                      {
                        op: "add",
                        value: {
                          ...(hotspot ? { hotspot } : {}),
                        },
                        path: patchPath.concat(["metadata"]),
                      },
                    ],
                    "object",
                  );
                } else {
                  console.warn(
                    `Expected source.metadata to be an object but got ${typeof source.metadata}`,
                  );
                }
              }}
            />
            {hotspot && (
              <div
                className="rounded-full h-[12px] w-[12px] bg-background mix-blend-difference border-bg-brand-primary border-2 absolute pointer-events-none"
                style={{
                  top: `${hotspot.y * 100}%`,
                  left: `${hotspot.x * 100}%`,
                }}
              />
            )}
          </div>
        )}
        <Button asChild variant={"secondary"}>
          <label htmlFor={`img_input:${path}`}>Upload</label>
        </Button>
        <input
          disabled={sourceAtPath.status === "loading"}
          hidden
          id={`img_input:${path}`}
          type="file"
          accept={schemaAtPath.data.options?.accept || "image/*"}
          onChange={(ev) => {
            readImage(ev).then((res) => {
              const type = "image";
              const prevUrl: string | null = url;
              setUrl(res.src);
              setLoading(true);

              const data = { src: res.src, filename: res.filename };
              let metadata: ImageMetadata | undefined;
              if (res.width && res.height && res.mimeType) {
                metadata = {
                  width: res.width,
                  height: res.height,
                  mimeType: res.mimeType,
                  alt:
                    maybeSourceData &&
                    typeof maybeSourceData?.metadata?.alt === "string"
                      ? maybeSourceData.metadata.alt
                      : undefined,
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
                      setProgressPercentage(Math.round(overallProgress * 100));
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
  );
}

function getRemoteFilesError(
  reason:
    | "unknown-error"
    | "project-not-configured"
    | "api-key-missing"
    | "pat-error"
    | "error-could-not-get-settings"
    | "no-internet-connection"
    | "unauthorized-personal-access-token-error"
    | "unauthorized",
) {
  switch (reason) {
    case "api-key-missing":
      return "Val is running in production mode. To upload remote files and images, the VAL_API_KEY env must be set. Contact a developer to fix this issue.";
    case "error-could-not-get-settings":
      return `Could not get settings from the Val remote server. This means that updating or changing certain types of files and images might not work. Check your internet connection and try again. (Error code: ${reason})`;
    case "no-internet-connection":
      return "Cannot upload remote files and images, since this requires an internet connection";
    case "pat-error":
      return "Val is running in development mode. To upload remote files and images, you must either login (by running `npx -p @valbuild/cli val login`) or set the VAL_API_KEY env";
    case "project-not-configured":
      return "Project is not configured. To upload remote files and images, the val.config must contain a project id that is obtained from https://app.val.build. Contact a developer to fix this issue.";
    case "unauthorized":
      return "Cannot upload remote files and images since you are unauthorized";
    case "unauthorized-personal-access-token-error":
      return "Cannot upload remote files and images since the personal access token is unauthorized. Try to login again by running `npx -p @valbuild/cli val login`";
    case "unknown-error":
      return "Unknown error";
    default: {
      const exhaustiveCheck: never = reason;
      return exhaustiveCheck;
    }
  }
}

export function ImagePreview({ path }: { path: SourcePath }) {
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
  const source = sourceAtPath.data;
  return (
    <img
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
      draggable={false}
      className="object-contain max-w-[60px] max-h-[60px] rounded-lg"
    />
  );
}
