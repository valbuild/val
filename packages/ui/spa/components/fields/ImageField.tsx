import {
  Internal,
  ModuleFilePath,
  SourcePath,
  VAL_EXTENSION,
  FILE_REF_PROP,
  FILE_REF_SUBTYPE_TAG,
} from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useFieldCreatorId,
  useValConfig,
  useSchemas,
  useFilePatchIds,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ValidationErrors } from "../../components/ValidationError";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../designSystem/input";
import { Loader2, Upload } from "lucide-react";
import { Button } from "../designSystem/button";
import { Checkbox } from "../designSystem/checkbox";
import { useValPortal } from "../ValPortalProvider";
import { ModuleMediaPicker } from "../MediaPicker/MediaPicker";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";
import { cn } from "../designSystem/cn";
import type { GalleryEntry } from "../MediaPicker/MediaPicker";
import { JSONValue } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";
import { useImageUpload } from "./useImageUpload";
import { MediaSummaryRow, Section, readableFilename } from "./MediaSummaryRow";

export function ImageField({
  path,
  readonly,
  hideUpload,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
  hideUpload?: boolean;
}) {
  const type = "image";
  const creatorId = useFieldCreatorId();
  const config = useValConfig();
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const schemas = useSchemas();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type, creatorId);
  const [hotspot, setHotspot] = useState<{ y: number; x: number } | undefined>(
    undefined,
  );
  const [url, setUrl] = useState<string | null>(null);
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
  const filePatchIds = useFilePatchIds();
  const maybeSourceData = "data" in sourceAtPath && sourceAtPath.data;
  const maybeClientSideOnly =
    sourceAtPath.status === "success" && sourceAtPath.clientSideOnly;
  useEffect(() => {
    if (maybeSourceData) {
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
      }
      if (maybeSourceData.metadata) {
        const metadata = maybeSourceData.metadata;
        if (
          typeof metadata.width !== "number" ||
          typeof metadata.height !== "number"
        ) {
          console.warn(
            `Expected metadata width and height to be numbers but width was: ${typeof metadata.width} and height was: ${typeof metadata.height}`,
          );
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
  }, [sourceAtPath, filePatchIds]);
  /**
   * Everything below this comment is a HOOK, and it lives above the early
   * returns because React counts them.
   *
   * These three used to sit after the `loading` / `not-found` / wrong-type
   * guards, which is a Rules of Hooks violation with a real symptom: a field
   * whose value is `null` (an `s.image().nullable()` that nothing has uploaded
   * to yet) took an early return on the first render and then ran three more
   * hooks once source arrived, so opening one crashed the Studio with "Rendered
   * more hooks than during the previous render" from inside `useMemo`.
   *
   * So they are computed unconditionally and defensively — every input is read
   * through a status check rather than assumed — and the guards follow.
   */
  const imageSchema =
    schemaAtPath.status === "success" && schemaAtPath.data.type === "image"
      ? schemaAtPath.data
      : undefined;
  const referencedModule = imageSchema?.referencedModule;
  const acceptOptions = useMemo(() => {
    if (!imageSchema || schemas.status !== "success") {
      return undefined;
    }
    if (imageSchema.options?.accept) {
      return imageSchema.options.accept;
    }
    if (!referencedModule) {
      return undefined;
    }
    const moduleSchema = schemas.data[referencedModule as ModuleFilePath];
    if (moduleSchema?.type === "record" && moduleSchema.accept) {
      return moduleSchema.accept;
    }
    return undefined;
  }, [imageSchema, referencedModule, schemas]);
  /**
   * Where an upload from this field is stored.
   *
   * The field's OWN `directory` option wins, then the gallery it references, and
   * `createFilePatch` falls back to `/public/val` when neither says. Only the
   * referenced module was read before, so `s.image({ directory: "/public/x" })`
   * silently wrote to `/public/val` — the file landed somewhere the schema
   * forbids, and `files:check-directory` then reported the content as invalid.
   */
  const uploadDirectory = useMemo(() => {
    if (imageSchema?.options?.directory) {
      return imageSchema.options.directory;
    }
    if (!referencedModule || schemas.status !== "success") return undefined;
    const moduleSchema = schemas.data[referencedModule as ModuleFilePath];
    return moduleSchema?.type === "record" ? moduleSchema.directory : undefined;
  }, [imageSchema, referencedModule, schemas]);
  const existingAlt =
    maybeSourceData && typeof maybeSourceData?.metadata?.alt === "string"
      ? maybeSourceData.metadata.alt
      : undefined;
  const remoteData =
    imageSchema?.remote &&
    remoteFiles.status === "ready" &&
    currentRemoteFileBucket &&
    config
      ? {
          publicProjectId: remoteFiles.publicProjectId,
          bucket: currentRemoteFileBucket,
          coreVersion: remoteFiles.coreVersion,
          schema: imageSchema,
          remoteHost: config.remoteHost,
        }
      : null;
  const { uploadImage, loading, error, progressPercentage } = useImageUpload({
    patchPath,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
    remoteData,
    directory: uploadDirectory,
    referencedModule,
    existingAlt,
  });
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
    schemaAtPath.data.type === "image" &&
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
  /**
   * What the summary row says about the file.
   *
   * Read off the ref and the metadata Val already has: the ref's last segment is
   * the file name, and `width`/`height`/`mimeType` are what an `s.image()` keeps.
   * Byte size is NOT among them — Val does not record it — so it is absent
   * rather than guessed.
   */
  const fileName = source
    ? (source[FILE_REF_PROP].split("/").pop() ?? source[FILE_REF_PROP])
    : null;
  const fileDetail = (() => {
    if (!source?.metadata) return null;
    const { width, height, mimeType } = source.metadata;
    const parts: string[] = [];
    if (typeof width === "number" && typeof height === "number") {
      parts.push(`${width} × ${height}`);
    }
    if (typeof mimeType === "string") parts.push(mimeType);
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  /**
   * The description, as one place rather than inline in the input.
   *
   * The "add, never replace" rule below is the load-bearing part and the reason
   * this is worth naming: it has to hold for every caller, and there are two now
   * — typing, and the shortcut that fills it in from the file name.
   */
  const altText =
    source?.metadata?.alt && typeof source.metadata.alt === "string"
      ? source.metadata.alt
      : "";
  const setAltText = (alt: string) => {
    if (!source) return;
    if (source.metadata) {
      // Always "add", never "replace", even when alt is already
      // there: "add" on an object key is create-or-set in both
      // JSONOps and the source-file ops, so it means the same thing
      // but survives the key having gone away. Choosing between the
      // two from `source` decides against the *client's optimistic*
      // view, which a concurrent image upload can invalidate before
      // the patch is applied - a "replace" then fails at publish
      // with "Cannot replace object element which does not exist".
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
  };

  const metadataPath = Internal.createValPathOfItem(path, "metadata");
  const altPath = Internal.createValPathOfItem(metadataPath, "alt");
  const hotspotPath = Internal.createValPathOfItem(metadataPath, "hotspot");
  return (
    <div id={path}>
      <ValidationErrors path={path} />
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
      {schemaAtPath.data.type === "image" &&
        schemaAtPath.data.remote &&
        remoteFiles.status === "inactive" && (
          <div className="p-4 rounded bg-bg-error-primary text-fg-error-primary">
            {getRemoteFilesError(remoteFiles.reason)}
          </div>
        )}
      {/*
       * The file, then what it is of, then where to look at it.
       *
       * Deliberately in that order and not in tabs. The description is the one
       * an editor is most likely to skip and the one a page is least able to do
       * without, so it sits directly under the file; the focal point only
       * matters once there is a file to crop.
       *
       * The summary row is what changed: the image used to be rendered full
       * width at the top, which meant the answer to "which image is this"
       * needed the whole field's height and told you nothing about the file —
       * not its name, not its size, not whether the page is using the copy you
       * think it is.
       */}
      <div className="flex flex-col gap-5">
        <MediaSummaryRow
          url={url}
          name={fileName}
          detail={fileDetail}
          hotspot={hotspot}
          uploading={loading}
          progressPercentage={progressPercentage}
          actions={
            <>
              {/*
               * One control for "which file", not two.
               *
               * A field that owns its file has nothing to choose between, so
               * Choose asset opens the file dialog directly. A field pointing
               * into a collection has a list, so it opens that — with the upload
               * inside it, because picking a file for the field and adding one to
               * the collection are the same decision from the editor's side and
               * splitting them means finding out only after opening the list
               * that what you want is not in it.
               */}
              {!hideUpload && referencedModule && (
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
                            [FILE_REF_SUBTYPE_TAG]: "image",
                            metadata: entry.metadata as JSONValue,
                          },
                        },
                      ],
                      "image",
                    );
                  }}
                  isImage
                  disabled={disabled}
                  portalContainer={portalContainer}
                />
              )}
              {!hideUpload && (
                <>
                  {/* The field's own file, so there is nothing to pick from:
                      Choose asset IS the file dialog. Hidden when the field
                      points into a collection, where the picker offers it. */}
                  {!referencedModule && (
                    <Button
                      variant={"outline"}
                      size="sm"
                      disabled={disabled}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      {url ? "Replace" : "Choose asset"}
                    </Button>
                  )}
                  <input
                    disabled={disabled}
                    hidden
                    ref={fileInputRef}
                    id={`img_input:${path}`}
                    type="file"
                    accept={acceptOptions ?? "image/*"}
                    onChange={(ev) => {
                      const imageFile = ev.currentTarget.files?.[0];
                      if (!imageFile) return;
                      const prevUrl: string | null = url;
                      uploadImage(imageFile).then((result) => {
                        if (!result) {
                          setUrl(prevUrl);
                        }
                      });
                      ev.target.value = "";
                    }}
                  />
                </>
              )}
            </>
          }
        />
        {/*
         * Only for a field that is NOT gallery-backed. A gallery keeps alt on
         * its entry, so a field referencing one must not offer a second place
         * to write it.
         *
         * This asked `!moduleDirectory` when that was only ever set for a
         * referenced module. It is not any more — a field's own `directory`
         * option sets it too — so the question is asked directly.
         */}
        {source && !referencedModule && (
          <Section
            label="Description"
            hint="What the image shows, for people who cannot see it."
          >
            <span id={altPath} className="sr-only">
              Description
            </span>
            <Input
              value={altText}
              disabled={disabled}
              onChange={(ev) => setAltText(ev.target.value)}
            />
            <div className="mt-1.5 flex items-center gap-3">
              {altText === "" && (
                // Said, not enforced: Val has no rule that alt is required, and
                // an editor who has not filled it in should be told rather than
                // blocked.
                <span className="text-[0.6875rem] text-fg-error-on-surface">
                  Missing
                </span>
              )}
              {!disabled && fileName && altText === "" && (
                <button
                  type="button"
                  onClick={() => setAltText(readableFilename(fileName))}
                  className="text-[0.6875rem] text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
                >
                  Use the filename
                </button>
              )}
            </div>
          </Section>
        )}
        {source && url && (
          <Section
            label="Focal point"
            hint="The part that must stay in frame when the page crops this image."
          >
            {source && url && (
              <div className="relative rounded-lg bg-bg-secondary">
                {loading && (
                  <div className="flex absolute inset-0 flex-col justify-center items-center">
                    <div className="absolute inset-0 w-full h-full opacity-50 bg-bg-secondary" />
                    <Loader2 size={24} className="animate-spin" />
                    <div className="mt-2 text-xs font-thin text-[white] z-5">
                      {progressPercentage !== null
                        ? `${progressPercentage}%`
                        : ""}
                    </div>
                  </div>
                )}
                <img
                  src={url}
                  draggable={false}
                  className="object-contain max-h-[500px] w-full"
                  style={{
                    cursor: readonly ? "default" : "crosshair",
                  }}
                  id={hotspotPath}
                  onClick={(ev) => {
                    if (readonly) return;
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
                    className="absolute pointer-events-none"
                    style={{
                      top: `${hotspot.y * 100}%`,
                      left: `${hotspot.x * 100}%`,
                      transform: "translate(-50%, -50%)",
                      zIndex: 10,
                    }}
                  >
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        border: "2px solid white",
                        boxShadow:
                          "0 0 0 1px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(0,0,0,0.3)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: "4px",
                        height: "4px",
                        borderRadius: "50%",
                        backgroundColor: "white",
                        boxShadow: "0 0 2px rgba(0,0,0,0.5)",
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            {source && url && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`hotspot_toggle:${path}`}
                  checked={!!hotspot}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      const defaultHotspot = { x: 0.5, y: 0.5 };
                      if (source.metadata) {
                        // "add" regardless of whether hotspot is already set: see
                        // the alt field above for why choosing "replace" from the
                        // optimistic source is a publish failure waiting to happen.
                        addPatch(
                          [
                            {
                              op: "add",
                              path: patchPath.concat(["metadata", "hotspot"]),
                              value: defaultHotspot,
                            },
                          ],
                          "object",
                        );
                      }
                    } else {
                      if (source.metadata && "hotspot" in source.metadata) {
                        addPatch(
                          [
                            {
                              op: "remove",
                              path: patchPath.concat([
                                "metadata",
                                "hotspot",
                              ]) as array.NonEmptyArray<string>,
                            },
                          ],
                          "object",
                        );
                      }
                    }
                  }}
                />
                <label
                  htmlFor={`hotspot_toggle:${path}`}
                  className="text-xs text-fg-secondary select-none"
                >
                  Hotspot
                  {hotspot && (
                    <span className="ml-1 text-fg-tertiary">
                      ({Math.round(hotspot.x * 100)}%,{" "}
                      {Math.round(hotspot.y * 100)}
                      %)
                    </span>
                  )}
                </label>
              </div>
            )}
          </Section>
        )}
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
      return "Project is not configured. To upload remote files and images, the val.config must contain a project id that is obtained from https://admin.val.build. Contact a developer to fix this issue.";
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
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
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
