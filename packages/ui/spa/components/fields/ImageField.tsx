import { Internal, Json, ModuleFilePath, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useShallowSourceAtPath,
  useValField,
  useValConfig,
  useModuleSchema,
  useFilePatchIds,
  useSourceAtPath,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../designSystem/input";
import { Upload, X } from "lucide-react";
import { Button } from "../designSystem/button";
import { Checkbox } from "../designSystem/checkbox";
import { useValPortal } from "../ValPortalProvider";
import { ModuleMediaPicker } from "../MediaPicker/MediaPicker";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";
import { cn } from "../designSystem/cn";
import type { GalleryEntry } from "../MediaPicker/MediaPicker";
import { array } from "@valbuild/core/fp";
import { resolveEncodeSettings } from "../../utils/encodeImage";
import type { ReadImageEncode } from "../../utils/readImage";
import { useImageUpload } from "./useImageUpload";
import { Section } from "./MediaSummaryRow";
import { ImageCard } from "./ImageCard";
import { MediaThumbnail, mayBeTransparent } from "../MediaThumbnail";
import { useMediaUrl } from "../../utils/mediaUrl";
import { isJsonArray } from "../../utils/isJsonArray";
import { HotspotMarker } from "./HotspotMarker";
import { FocalPointPicker } from "./FocalPointPicker";
import { Dialog, DialogContent, DialogTitle } from "../designSystem/dialog";

export function ImageField({
  path,
  readonly,
  hideUpload,
  compact,
}: {
  path: SourcePath;
  readonly?: boolean;
  /** Where there are many or there is little room. See `ImageCard`. */
  compact?: boolean;
  hideUpload?: boolean;
}) {
  const type = "image";
  const config = useValConfig();
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const {
    source: sourceAtPath,
    schema: schemaAtPath,
    addPatch,
    patchPath,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  } = useValField(path, type);
  const [hotspot, setHotspot] = useState<{ y: number; x: number } | undefined>(
    undefined,
  );
  const [url, setUrl] = useState<string | null>(null);
  /**
   * Whether the image is open at a size worth looking at.
   *
   * The thumbnail identifies the file; it is far too small to judge one by. A
   * dialog rather than growing the row, because "is this the right photo" is a
   * question you ask once and then stop asking, and a field that answers it
   * permanently is a field whose controls are all below the fold.
   *
   * Up here with the other hooks, ON PURPOSE: everything below the `not-found`
   * and `loading` guards runs only on some renders, and a hook there is
   * "Rendered more hooks than during the previous render" the first time this
   * field mounts with no value — which is every empty image field.
   */
  const [previewOpen, setPreviewOpen] = useState(false);
  /** Why the last file was refused, until the next upload. */
  const [fileError, setFileError] = useState<string | null>(null);
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
        const patchId = filePatchIds.get(maybeSourceData.path);
        setUrl(
          Internal.mediaUrl({
            path: maybeSourceData.path,
            ...(patchId ? { patch_id: patchId } : {}),
          }),
        );
      }
      const hotspot = maybeSourceData.hotspot;
      if (hotspot) {
        if (typeof hotspot.x === "number" && typeof hotspot.y === "number") {
          setHotspot({ x: hotspot.x, y: hotspot.y });
        } else {
          console.warn(
            `Expected hotspot to have x and y as numbers but x was: ${typeof hotspot.x} and y: ${typeof hotspot.y}`,
          );
        }
      } else {
        setHotspot(undefined);
      }
    } else if (maybeSourceData === null) {
      // The field was cleared. The URL is state rather than derived, so it
      // survives the source going away unless it is cleared too — and a
      // thumbnail of the image you just removed is indistinguishable from the
      // removal not having worked.
      setUrl(null);
      setHotspot(undefined);
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
  const referencedModuleFilePath = referencedModule as
    | ModuleFilePath
    | undefined;
  /**
   * The referenced GALLERY's schema, not the project's.
   *
   * `useSchemas()` answers the same question and wakes on every schema change
   * anywhere; this component is mounted once per media field. See
   * `perFieldSubscriptions.test.ts`.
   */
  const referencedModuleSchema = useModuleSchema(referencedModuleFilePath);
  const acceptOptions = useMemo(() => {
    if (!imageSchema) {
      return undefined;
    }
    if (imageSchema.options?.accept) {
      return imageSchema.options.accept;
    }
    if (!referencedModule) {
      return undefined;
    }
    if (
      referencedModuleSchema?.type === "record" &&
      referencedModuleSchema.accept
    ) {
      return referencedModuleSchema.accept;
    }
    return undefined;
  }, [imageSchema, referencedModule, referencedModuleSchema]);
  /**
   * Where an upload from this field is stored.
   *
   * The field's OWN `directory` option wins, then the gallery it references, and
   * `createFilePatch` falls back to `/public/val` when neither says. Only the
   * referenced module was read before, so `s.image({ dir: "/public/x" })`
   * silently wrote to `/public/val` — the file landed somewhere the schema
   * forbids, and `files:check-directory` then reported the content as invalid.
   */
  const uploadDirectory = useMemo(() => {
    if (imageSchema?.options?.dir) {
      return imageSchema.options.dir;
    }
    return referencedModuleSchema?.type === "record"
      ? referencedModuleSchema.dir
      : undefined;
  }, [imageSchema, referencedModuleSchema]);
  /**
   * How an upload is re-encoded, resolved the same way as `accept` above.
   *
   * The gallery fallback is not optional: `s.image(galleryVal)` serializes with
   * EMPTY options, so a gallery-backed field has nothing of its own to read and
   * would never honour what the gallery asked for.
   */
  const encode = useMemo<ReadImageEncode>(() => {
    const galleryEncode =
      referencedModuleSchema?.type === "record"
        ? referencedModuleSchema.encode
        : undefined;
    return {
      settings: resolveEncodeSettings(
        imageSchema?.options?.encode,
        galleryEncode,
      ),
      accept: acceptOptions,
    };
  }, [imageSchema, referencedModuleSchema, acceptOptions]);
  const existingAlt =
    maybeSourceData && typeof maybeSourceData.alt === "string"
      ? maybeSourceData.alt
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
    dir: uploadDirectory,
    referencedModule,
    existingAlt,
    encode,
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
    referencedModule && referencedModuleSchema === undefined
      ? [referencedModule]
      : [];
  const disabled =
    readonly || remoteFileUploadDisabled || missingModules.length > 0;
  /**
   * What the summary row says about the file.
   *
   * Read off the path and what Val already knows: the path's last segment is the
   * file name, and `width`/`height`/`mimeType` are what an `s.image()` keeps.
   * Byte size is NOT among them — Val does not record it — so it is absent
   * rather than guessed.
   */
  const fileName = source
    ? (source.path.split("/").pop() ?? source.path)
    : null;
  /**
   * The dimensions and type, from the field's own value or — for a field
   * backed by a gallery, whose value carries only `path`, `alt` and
   * `hotspot` — from the gallery's entry. See `GalleryEntryMetadata`.
   */
  const metadataOf = (entry: ImageMetadataLike | undefined) => {
    const width = source?.width ?? entry?.width;
    const height = source?.height ?? entry?.height;
    const mimeType =
      typeof source?.mimeType === "string" ? source.mimeType : entry?.mimeType;
    const parts: string[] = [];
    if (typeof width === "number" && typeof height === "number") {
      parts.push(`${width} × ${height}`);
    }
    if (typeof mimeType === "string") parts.push(mimeType);
    return {
      mimeType,
      fileDetail: parts.length > 0 ? parts.join(" · ") : null,
      // What the image is DRAWN with. The field's own description wins, then
      // the gallery's — the same order as `fillFromGallery` — because a
      // gallery-backed field hides its Description input: the gallery owns the
      // text, and without this every preview of it was `alt=""`.
      renderedAlt:
        typeof source?.alt === "string" ? source.alt : (entry?.alt ?? ""),
    };
  };

  /**
   * The description, as one place rather than inline in the input.
   *
   * The "add, never replace" rule below is the load-bearing part and the reason
   * this is worth naming: it has to hold for every caller. Typing is the only
   * one today — the shortcut that filled this in from the file name is gone —
   * and the rule belongs to the patch rather than to the caller, so it holds
   * for whatever writes here next.
   */
  const altText = typeof source?.alt === "string" ? source.alt : "";
  const setAltText = (alt: string) => {
    if (!source) return;
    // Always "add", never "replace", even when alt is already there: "add" on
    // an object key is create-or-set in both JSONOps and the source-file ops,
    // so it means the same thing but survives the key having gone away. A
    // "replace" decided against the client's optimistic view fails at publish
    // with "Cannot replace object element which does not exist" if a concurrent
    // upload invalidated it first.
    addPatch(
      [
        {
          op: "add",
          value: alt,
          path: patchPath.concat(["alt"]),
        },
      ],
      "string",
    );
  };

  /**
   * What the card offers: choosing a file, and removing it. The same set
   * whether the field is empty or not; which of them shows depends on `source`.
   */
  const actions = (
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
      {!hideUpload && referencedModuleFilePath && (
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
              Upload into {prettyModuleName(referencedModuleFilePath)}
            </button>
          }
          modulePath={referencedModuleFilePath}
          selectedRef={source?.path ?? null}
          onSelect={(entry: GalleryEntry) => {
            // Only the path: the dimensions and mime type stay in the
            // gallery, which is the one place that has them.
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  value: { path: entry.filePath },
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
      {/* The field's own file, so there is nothing to pick from:
          Choose asset IS the file dialog. Hidden when the field
          points into a collection, where the picker offers it. */}
      {!hideUpload && !referencedModule && (
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
      {/*
       * Clearing the field, for a schema that allows it.
       *
       * The field itself has to offer this, not only the `Field`
       * wrapper's nullable checkbox: an image opened on its own — an
       * array item, a record entry, a gallery-backed field — has no
       * wrapper, so without it a `.nullable()` image could be replaced
       * but never emptied.
       *
       * Gated on `readonly` alone rather than on `disabled`: the other
       * things that disable this field (remote uploads not ready, the
       * referenced gallery missing from `val.modules`) stop a file
       * going IN. Taking one out needs none of them, and a field
       * pointing at a gallery that is gone is exactly when an editor
       * wants to.
       *
       * An upload IN FLIGHT is the exception, and it is an ordering
       * bug rather than a permission: `uploadImage` reads, encodes and
       * hashes the file before it enqueues its `replace`, so a Remove
       * clicked inside that window writes `null` first and the upload
       * lands afterwards and puts the file back. Only reachable while
       * REPLACING — an empty field has nothing to remove — which is
       * exactly when it looks like the removal was ignored.
       */}
      {schemaAtPath.data.opt && source && !readonly && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => {
            addPatch([{ op: "replace", path: patchPath, value: null }], type);
          }}
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Remove
        </Button>
      )}
    </>
  );
  const upload = (imageFile: File) => {
    setFileError(null);
    const prevUrl: string | null = url;
    uploadImage(imageFile).then((result) => {
      if (!result) {
        setUrl(prevUrl);
      }
    });
  };
  /**
   * Every file the editor hands this field — dropped, or chosen in the dialog,
   * whose "All files" option lets anything through just as a drop does. What
   * is refused here is only what is not an image at all, with a message that
   * says so; whether it is an image this field ACCEPTS is `useImageUpload`'s
   * check, made after re-encoding, where the stored type is known.
   */
  const acceptFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setFileError(`${file.name} is not an image.`);
      return;
    }
    upload(file);
  };

  const altPath = Internal.createValPathOfItem(path, "alt");
  const hotspotPath = Internal.createValPathOfItem(path, "hotspot");
  const render = (entry: ImageMetadataLike | undefined) => {
    const { mimeType, fileDetail, renderedAlt } = metadataOf(entry);
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
          // An alert: an upload refused for its type, or for not being
          // readable, is refused after the drop or the pick, with nothing
          // taking focus — so without this it is silent.
          <div
            role="alert"
            className="p-4 rounded bg-bg-error-primary text-fg-error-primary"
          >
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
         * The card is the image as a page would show it — a crop around the
         * focal point — with the file's name and particulars under it, so both
         * "what does the page get" and "which copy is this" are answered before
         * anything is clicked. See `ImageCard`.
         */}
        {!hideUpload && (
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
              // Through the same door as a drop: the dialog's "All files"
              // lets anything through, just as a drop does.
              acceptFile(imageFile);
              ev.target.value = "";
            }}
          />
        )}
        <div className="flex flex-col gap-5">
          <ImageCard
            url={url}
            alt={renderedAlt}
            name={fileName}
            detail={[
              fileDetail,
              hotspot
                ? `focal point ${Math.round(hotspot.x * 100)}%, ${Math.round(hotspot.y * 100)}%`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            mimeType={mimeType}
            hotspot={hotspot}
            onOpenPreview={url ? () => setPreviewOpen(true) : undefined}
            uploading={loading}
            progressPercentage={progressPercentage}
            onDropFile={hideUpload ? undefined : acceptFile}
            dropDisabled={disabled || loading}
            emptyActions={actions}
            actions={actions}
            compact={compact}
          />
          {fileError && (
            // An alert, so a refused file is announced: the message appears
            // with nothing having taken focus, and is otherwise silent.
            <p role="alert" className="-mt-3 text-xs text-fg-error-primary">
              {fileError}
            </p>
          )}
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
              {/*
               * No "Missing" marker and no fill-it-from-the-filename shortcut:
               * Val has no rule that alt text is required, so an empty field is
               * not an error and must not be dressed as one. If a schema ever
               * does require it, the validation error says so through the
               * normal error path rather than through a badge invented here.
               */}
              <Input
                value={altText}
                disabled={disabled}
                onChange={(ev) => setAltText(ev.target.value)}
              />
            </Section>
          )}
          {source && url && (
            <Section
              label="Focal point"
              hint="Click or drag on the image to say what must stay in frame when the page crops it."
              collapsible
              summary={
                hotspot
                  ? `${Math.round(hotspot.x * 100)}%, ${Math.round(hotspot.y * 100)}%`
                  : "Not set"
              }
            >
              <FocalPointPicker
                url={url}
                checkerboard={mayBeTransparent(mimeType)}
                hotspot={hotspot}
                alt={renderedAlt}
                // Not while an upload is in flight, for the same reason as
                // Remove: the upload writes its whole-image `replace` only
                // once the bytes are up, so a focal point set in between is
                // written first and then overwritten — it moves, then vanishes.
                readonly={readonly || loading}
                id={hotspotPath}
                onChange={(hotspot) => {
                  addPatch(
                    [
                      {
                        op: "add",
                        path: patchPath.concat(["hotspot"]),
                        value: hotspot,
                      },
                    ],
                    "object",
                  );
                }}
              />
              {source && url && (
                <div className="mt-3 flex items-center gap-2">
                  <Checkbox
                    id={`hotspot_toggle:${path}`}
                    checked={!!hotspot}
                    // See the picker above: an upload in flight would
                    // overwrite whatever this writes.
                    disabled={disabled || loading}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        // "add" regardless of whether hotspot is already set: see
                        // the alt field above for why choosing "replace" from the
                        // optimistic source is a publish failure waiting to happen.
                        addPatch(
                          [
                            {
                              op: "add",
                              path: patchPath.concat(["hotspot"]),
                              value: { x: 0.5, y: 0.5 },
                            },
                          ],
                          "object",
                        );
                      } else if (source.hotspot) {
                        addPatch(
                          [
                            {
                              op: "remove",
                              path: patchPath.concat([
                                "hotspot",
                              ]) as array.NonEmptyArray<string>,
                            },
                          ],
                          "object",
                        );
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
        {url && (
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            {/*
             * Sized by the image, not by the viewport.
             *
             * `DialogContent` is `w-full`, so this was a 90vw box with the image
             * pinned to its left edge — a portrait photo sat in a corner beside
             * a wide empty panel. Worse, the focal point was drawn in that box
             * rather than on the photo: a `grid` child is stretched, so the
             * "shrink-wrapping" wrapper was as wide as the dialog, and a marker
             * at 70% of it landed on the empty panel. `w-max` makes the dialog
             * exactly the image's width (the image is capped in viewport units,
             * so that cannot overflow), and `justify-self-center` stops the
             * wrapper being stretched.
             */}
            <DialogContent
              container={portalContainer}
              className="w-max max-w-[90vw] gap-0 overflow-hidden p-0 md:w-max"
            >
              <DialogTitle className="sr-only">
                {fileName ?? "Image"}
              </DialogTitle>
              {/* The focal point is drawn here too: it is a property of the
                  image, and the large view is where it is actually legible. */}
              <div className="relative justify-self-center">
                <img
                  src={url}
                  alt={renderedAlt}
                  draggable={false}
                  className={cn(
                    "block h-auto max-h-[80vh] w-auto max-w-[90vw]",
                    mayBeTransparent(mimeType) && "val-checkerboard",
                  )}
                />
                {hotspot && <HotspotMarker hotspot={hotspot} />}
              </div>
              <div className="flex min-w-0 items-baseline gap-2 border-t border-border-secondary px-4 py-2.5 pr-10">
                <p className="truncate text-xs font-medium text-fg-primary">
                  {fileName}
                </p>
                <p className="shrink-0 text-[0.6875rem] text-fg-secondary-alt">
                  {[
                    fileDetail,
                    hotspot
                      ? `Focal point ${Math.round(hotspot.x * 100)}%, ${Math.round(hotspot.y * 100)}%`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    );
  };
  return referencedModuleFilePath && source ? (
    <GalleryEntryMetadata
      modulePath={referencedModuleFilePath}
      filePath={source.path}
    >
      {render}
    </GalleryEntryMetadata>
  ) : (
    render(undefined)
  );
}

type ImageMetadataLike = {
  width?: number;
  height?: number;
  mimeType?: string;
  alt?: string;
};

/**
 * The gallery entry a gallery-backed field points at, read on its own.
 *
 * A gallery-backed value is `{ path, alt?, hotspot? }` — the dimensions and
 * type live on the gallery's entry, keyed by the path — so without this the
 * card said nothing about the file and never drew the checkerboard for a
 * transparent one. A component rather than a hook in `ImageField` because the
 * hook needs a path to read, and a field that is not gallery-backed has none:
 * mounting this only when there is one keeps the hook unconditional.
 *
 * One entry, by path: `useSourceAtPath` peeks and demands that entry alone, so
 * a field does not subscribe to the whole gallery. See
 * `perFieldSubscriptions.test.ts`.
 *
 * Under TWO keys, the way `fillFromGallery` looks it up. A remote upload
 * stores the remote ref in the field but files the metadata under the local
 * `filePath` inside that ref, so the exact key misses and the split one hits.
 * Both reads are always made — a hook cannot be conditional — and for a local
 * path the second is the same path again.
 */
function GalleryEntryMetadata({
  modulePath,
  filePath,
  children,
}: {
  modulePath: ModuleFilePath;
  filePath: string;
  children: (entry: ImageMetadataLike | undefined) => ReactNode;
}) {
  const split = Internal.remote.splitRemoteRef(filePath);
  // Two components rather than two reads everywhere: for a local path the
  // second key IS the first, and `useSourceAtPath` gives every call its own
  // listener and demand, so reading it twice doubled the common case. The
  // cost is a remount if one field's value goes from a local path to a remote
  // ref, which a field's refs do not normally do.
  return split.status === "success" ? (
    <RemoteGalleryEntry
      modulePath={modulePath}
      filePath={filePath}
      localFilePath={split.filePath}
    >
      {children}
    </RemoteGalleryEntry>
  ) : (
    <LocalGalleryEntry modulePath={modulePath} filePath={filePath}>
      {children}
    </LocalGalleryEntry>
  );
}

function LocalGalleryEntry({
  modulePath,
  filePath,
  children,
}: {
  modulePath: ModuleFilePath;
  filePath: string;
  children: (entry: ImageMetadataLike | undefined) => ReactNode;
}) {
  const entry = useSourceAtPath(
    Internal.createValPathOfItem(modulePath, filePath) ?? modulePath,
  );
  return (
    <>
      {children(
        entry.status === "success" ? metadataFrom(entry.data) : undefined,
      )}
    </>
  );
}

function RemoteGalleryEntry({
  modulePath,
  filePath,
  localFilePath,
  children,
}: {
  modulePath: ModuleFilePath;
  filePath: string;
  localFilePath: string;
  children: (entry: ImageMetadataLike | undefined) => ReactNode;
}) {
  const exact = useSourceAtPath(
    Internal.createValPathOfItem(modulePath, filePath) ?? modulePath,
  );
  const local = useSourceAtPath(
    Internal.createValPathOfItem(modulePath, localFilePath) ?? modulePath,
  );
  const entry =
    (exact.status === "success" ? metadataFrom(exact.data) : undefined) ??
    (local.status === "success" ? metadataFrom(local.data) : undefined);
  return <>{children(entry)}</>;
}

function metadataFrom(data: Json): ImageMetadataLike | undefined {
  if (typeof data !== "object" || data === null || isJsonArray(data)) {
    return undefined;
  }
  const { width, height, mimeType, alt } = data;
  return {
    width: typeof width === "number" ? width : undefined,
    height: typeof height === "number" ? height : undefined,
    mimeType: typeof mimeType === "string" ? mimeType : undefined,
    alt: typeof alt === "string" ? alt : undefined,
  };
}

export function getRemoteFilesError(
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
      // Not "production mode": every server that is not local dev answers this,
      // and a PAT cannot substitute for it -- a PAT is read from a file in a
      // working directory, which such a server does not have. Saying so stops
      // the reader hunting for the directory to run `val login` in.
      return "To upload remote files and images, this server needs the VAL_API_KEY env set. A personal access token cannot be used here: it is read from a file in a working directory, and this server has none. Contact a developer to fix this issue.";
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

/**
 * An image as one value in a summary — an array row that lists an object's
 * fields ("Type: image / Image: …"), for one.
 *
 * A fixed square cropped at the focal point, the way record rows
 * (`ListPreviewItem`) and the heading already draw an image. It was the whole
 * picture shrunk to fit 60×60, so a portrait was a sliver and a landscape a
 * strip: each row a different shape, and none of them what the page shows.
 *
 * The URL goes through `useMediaUrl` for the same reason as everywhere else: a
 * just-uploaded image is served from its patch, and `Internal.mediaUrl` of the
 * value alone drew a broken picture until the editor saved.
 */
export function ImagePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "image");
  const source =
    "data" in sourceAtPath && sourceAtPath.data ? sourceAtPath.data : null;
  // Above the early returns: a hook below one is a hook-order crash the
  // first time the value goes from loading to present.
  const url = useMediaUrl(source);
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null || !url) {
    return <PreviewNull path={path} />;
  }
  const hotspot = source?.hotspot;
  return (
    <MediaThumbnail
      url={url}
      alt={typeof source?.alt === "string" ? source.alt : ""}
      hotspot={
        hotspot &&
        typeof hotspot.x === "number" &&
        typeof hotspot.y === "number"
          ? { x: hotspot.x, y: hotspot.y }
          : undefined
      }
      checkerboard={mayBeTransparent(
        typeof source?.mimeType === "string" ? source.mimeType : undefined,
      )}
      loading="lazy"
      className="h-12 w-12 shrink-0 rounded-md border border-border-primary bg-bg-secondary"
    />
  );
}
