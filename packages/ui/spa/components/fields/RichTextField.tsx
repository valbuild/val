import {
  AllRichTextOptions,
  ImageMetadata,
  ModuleFilePath,
  RichTextSource,
  SourcePath,
} from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import type { Patch, ReadonlyJSONValue } from "@valbuild/core/patch";
import { deepEqual, JSONValue } from "@valbuild/core/patch";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import {
  ShallowSource,
  useAddPatch,
  useFieldCreatorId,
  useModuleSchema,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useValConfig,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import { RichTextEditor } from "../RichTextEditor";
import type { EditorDocument, RichTextEditorRef } from "../RichTextEditor";
import { useRichTextEditorConfig } from "../RichTextEditor/useRichTextEditorConfig";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useValPortal } from "../ValPortalProvider";
import { readImageFromFile } from "../../utils/readImage";
import { createFilePatch } from "./FileField";

const DEBOUNCE_MS = 400;

export function RichTextField({
  path,
  readonly,
}: {
  path: SourcePath;
  autoFocus?: boolean; // TODO: implement autoFocus
  readonly?: boolean;
  compact?: boolean; // TODO: implement compact
}) {
  const type = "richtext";
  const creatorId = useFieldCreatorId();
  const config = useValConfig();
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type, creatorId);
  const currentSourceData =
    "data" in sourceAtPath
      ? (sourceAtPath.data as RichTextSource<AllRichTextOptions>)
      : undefined;

  const editorRef = useRef<RichTextEditorRef>(null);
  const sourceRef = useRef<EditorDocument>(
    (currentSourceData as unknown as EditorDocument) ?? [],
  );
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disabledRef = useRef(false);
  const suppressNextDirtyRef = useRef(false);
  /**
   * Typed, but not yet turned into a patch.
   *
   * True from a keystroke until the debounced patch is added. See the sync
   * effect below: this is the difference between "the server disagrees with me
   * because someone else edited" and "the server disagrees with me because I am
   * still typing".
   */
  const hasUnsentEditRef = useRef(false);
  /**
   * The document as of the last keystroke, captured eagerly.
   *
   * Read by the unmount flush below, which cannot ask the editor for it — by
   * then the editor may already be gone.
   */
  const pendingDocRef = useRef<EditorDocument | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const {
    patchPath,
    addPatch,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  } = useAddPatch(path, creatorId);

  const maybeClientSideOnly =
    "clientSideOnly" in sourceAtPath && sourceAtPath.clientSideOnly;

  /**
   * Take the server's document only when the change came from somewhere else.
   *
   * The editor is uncontrolled — it owns its document and reports changes
   * through `onDirty` — so a `reset` is not a re-render, it is throwing your
   * text away and putting someone else's in its place. Which is right when
   * someone else wrote it, and a bug when you did.
   *
   * `clientSideOnly` alone was not enough to tell those apart. It answers "does
   * this field have an unsaved patch", and there is a 400ms window on every
   * keystroke where the answer is no and the editor is still ahead of the
   * server: the previous patch has saved, and the next one has not been made
   * yet. A source update landing in that window compared unequal and reset the
   * editor to the last saved document — which is the jumping caret and the
   * letters coming back after being deleted.
   *
   * So the debounce is part of the question. `hasUnsentEdit` is true from the
   * keystroke until its patch is actually added, and while it is true nothing
   * from outside is allowed to overwrite what is being typed. A foreign change
   * arriving mid-word is not lost — it lands on the next update, once the
   * typing has settled — and losing your own sentence is much worse than seeing
   * someone else's a second late.
   */
  useEffect(() => {
    if (maybeClientSideOnly !== false || !currentSourceData) return;
    if (hasUnsentEditRef.current) return;
    const serverDoc = currentSourceData as unknown as EditorDocument;
    const currentDoc = editorRef.current?.getDocument();
    if (
      currentDoc &&
      !deepEqual(
        currentDoc as unknown as ReadonlyJSONValue,
        serverDoc as unknown as ReadonlyJSONValue,
      )
    ) {
      editorRef.current?.reset(serverDoc);
      sourceRef.current = serverDoc;
    }
  }, [currentSourceData, maybeClientSideOnly]);

  const portalContainer = useValPortal();

  const schemaOptions =
    "data" in schemaAtPath && schemaAtPath.data.type === "richtext"
      ? schemaAtPath.data.options
      : undefined;
  const { features, linkCatalog, imageModulePath, imageSchema } =
    useRichTextEditorConfig(schemaOptions);

  const hasImageEnabled = !!schemaOptions?.inline?.img;

  const imageReferencedModule = imageSchema?.referencedModule as
    | ModuleFilePath
    | undefined;
  /**
   * The GALLERY's schema, not the project's.
   *
   * This used to read `useSchemas()` — every schema in the project, woken by
   * every schema change — to look up one module and take two fields off it.
   * `useSchemas` is a whole-project subscription and this component is mounted
   * once per rich text field.
   */
  const imageModuleSchema = useModuleSchema(imageReferencedModule);
  const imageAcceptOptions = useMemo(() => {
    if (!hasImageEnabled) return undefined;
    if (imageSchema?.options?.accept) return imageSchema.options.accept;
    if (imageModuleSchema?.type === "record" && imageModuleSchema.accept) {
      return imageModuleSchema.accept;
    }
    return undefined;
  }, [hasImageEnabled, imageSchema, imageModuleSchema]);

  const imageModuleDirectory = useMemo(
    () =>
      imageModuleSchema?.type === "record"
        ? imageModuleSchema.directory
        : undefined,
    [imageModuleSchema],
  );

  const imageRemoteData = useMemo(() => {
    if (
      !hasImageEnabled ||
      !imageSchema?.remote ||
      remoteFiles.status !== "ready" ||
      !currentRemoteFileBucket ||
      !config?.remoteHost
    ) {
      return null;
    }
    return {
      publicProjectId: remoteFiles.publicProjectId,
      bucket: currentRemoteFileBucket,
      coreVersion: remoteFiles.coreVersion,
      schema: imageSchema,
      remoteHost: config.remoteHost,
    };
  }, [
    hasImageEnabled,
    imageSchema,
    remoteFiles,
    currentRemoteFileBucket,
    config,
  ]);

  const onImageUpload = useMemo(() => {
    if (!hasImageEnabled) return undefined;

    return async (
      file: File,
      insertIntoView: (
        ref: string,
        opts?: {
          previewUrl?: string;
          width?: number;
          height?: number;
          mimeType?: string;
        },
      ) => string[] | null,
    ): Promise<{ filePath: string; ref: string } | null> => {
      try {
        const res = await readImageFromFile(file);

        let metadata: ImageMetadata | undefined;
        if (res.width && res.height && res.mimeType) {
          metadata = {
            width: res.width,
            height: res.height,
            mimeType: res.mimeType,
          };
        }

        const { patch, filePath } = await createFilePatch(
          patchPath,
          res.src,
          res.filename ?? null,
          res.fileHash,
          metadata,
          "image",
          imageRemoteData,
          imageModuleDirectory,
          !!imageReferencedModule,
        );

        if (patch.length === 0) return null;

        const refFromPatch =
          patch[0] &&
          "value" in patch[0] &&
          typeof patch[0].value === "object" &&
          patch[0].value !== null &&
          "path" in patch[0].value
            ? (patch[0].value.path as string)
            : filePath;

        const fileOps = patch.filter((op) => op.op === "file");

        suppressNextDirtyRef.current = true;
        const nestedFilePath = insertIntoView(refFromPatch, {
          previewUrl: res.src,
          width: metadata?.width,
          height: metadata?.height,
          mimeType: metadata?.mimeType,
        });

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        // This path patches the document itself, below, so the pending keystroke
        // it just cancelled is accounted for. Leaving the flag set would block
        // every foreign update from here on.
        hasUnsentEditRef.current = false;

        const doc = editorRef.current?.getDocument();
        if (!doc) return null;

        const replacePatch = createRichTextPatch(patchPath, doc);
        sourceRef.current = doc;

        const fileOpsWithNestedPath = fileOps.map((op) => ({
          ...op,
          ...(nestedFilePath ? { nestedFilePath } : {}),
        }));

        const combinedPatch: Patch = [
          ...replacePatch,
          ...fileOpsWithNestedPath,
        ];

        const moduleFilePatches: {
          moduleFilePath: ModuleFilePath;
          patch: Patch;
        }[] = [];
        if (
          imageReferencedModule &&
          filePath &&
          metadata?.mimeType &&
          metadata.width !== undefined &&
          metadata.height !== undefined
        ) {
          moduleFilePatches.push({
            moduleFilePath: imageReferencedModule as ModuleFilePath,
            patch: [
              {
                op: "add",
                path: [filePath],
                value: {
                  width: metadata.width,
                  height: metadata.height,
                  mimeType: metadata.mimeType,
                  alt: null,
                } as JSONValue,
              },
            ],
          });
        }

        setUploadProgress(0);
        await addAndUploadPatchWithFileOps(
          combinedPatch,
          "image",
          (errorMessage) => {
            console.error("Failed to upload image in richtext:", errorMessage);
            setUploadProgress(null);
          },
          (bytesUploaded, totalBytes, currentFile, totalFiles) => {
            const progress =
              totalBytes > 0
                ? Math.round(
                    ((bytesUploaded * (currentFile + 1)) /
                      (totalBytes * totalFiles)) *
                      100,
                  )
                : 0;
            setUploadProgress(Math.min(progress, 100));
          },
        );
        setUploadProgress(null);

        for (const entry of moduleFilePatches) {
          addModuleFilePatch(entry.moduleFilePath, entry.patch, "record");
        }

        return { filePath, ref: refFromPatch };
      } catch (err) {
        console.error("Failed to prepare image for upload", err);
        setUploadProgress(null);
        return null;
      }
    };
  }, [
    hasImageEnabled,
    patchPath,
    imageRemoteData,
    imageModuleDirectory,
    imageReferencedModule,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  ]);

  const handleDirty = useCallback(() => {
    if (disabledRef.current) return;
    if (suppressNextDirtyRef.current) {
      suppressNextDirtyRef.current = false;
      return;
    }

    hasUnsentEditRef.current = true;
    // Captured now, not in the timer: the unmount flush needs a document that
    // does not depend on the editor still being mounted.
    pendingDocRef.current = editorRef.current?.getDocument() ?? null;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      writePendingRef.current();
    }, DEBOUNCE_MS);
  }, []);

  /**
   * Write whatever was typed, now.
   *
   * In a ref because the unmount cleanup below runs after the last render and
   * must use the current `patchPath` and `addPatch`, not the ones it closed over
   * when it was attached.
   */
  const writePendingRef = useRef<() => void>(() => undefined);
  writePendingRef.current = () => {
    const doc = pendingDocRef.current ?? editorRef.current?.getDocument();
    if (!doc) return;
    pendingDocRef.current = null;
    const patch = createRichTextPatch(patchPath, doc);
    sourceRef.current = doc;
    addPatch(patch, "richtext");
    // Cleared only once the patch exists: from here `clientSideOnly` is what
    // keeps the server's document out until this one has been saved.
    hasUnsentEditRef.current = false;
  };

  /**
   * An edit still inside the debounce window when the field goes away is
   * WRITTEN, not dropped.
   *
   * This used to clear the timer and forget it, which loses the last thing
   * typed — navigating away, closing the canvas, or switching page mid-sentence
   * silently threw those characters out. The window is short, so the loss looked
   * random, which is the worst way for it to look.
   */
  useEffect(
    () => () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        writePendingRef.current();
      }
      hasUnsentEditRef.current = false;
    },
    [],
  );

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
    sourceAtPath.status === "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
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
  if (!config?.remoteHost) {
    console.warn(
      "RichTextField: config.remoteHost is not set. Remote images will not work.",
    );
  }
  return (
    <div id={path} className="m-1">
      <RichTextEditor
        ref={editorRef}
        /**
         * The document the editor MOUNTS with.
         *
         * It used to be given none, so the view was always built empty and the
         * content arrived afterwards through `reset()` in the sync effect above.
         * That made the effect load-bearing for the initial paint, and the
         * effect's deps are the source — so anything that rebuilt the view
         * without moving source (a toolbar feature settling, a portal container
         * arriving) left a permanently blank field with nothing to refill it.
         *
         * Uncontrolled still: this is read once, at mount. `reset()` remains how
         * a FOREIGN change lands.
         */
        defaultValue={
          (currentSourceData as unknown as EditorDocument | null) ?? []
        }
        features={features}
        linkCatalog={linkCatalog}
        readOnly={readonly || disabledRef.current}
        onDirty={handleDirty}
        imageModulePath={imageModulePath}
        onImageUpload={onImageUpload}
        imageAccept={imageAcceptOptions}
        uploadProgress={uploadProgress}
        portalContainer={portalContainer}
      />
    </div>
  );
}

function createRichTextPatch(path: string[], content: EditorDocument): Patch {
  return [
    {
      op: "replace" as const,
      path,
      value: content as unknown as Parameters<typeof JSON.stringify>[0],
    },
  ];
}

export function RichTextPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "richtext");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (sourceAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="richtext" />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const asString = richTextToString(sourceAtPath.data);
  if (asString.status === "error") {
    return <FieldSourceError path={path} error={asString.error} />;
  }
  return <div className="truncate">{asString.value}</div>;
}

function richTextToString(source: ShallowSource["richtext"]):
  | {
      status: "error";
      error: string;
    }
  | {
      status: "ok";
      value: string;
    } {
  let error: string | undefined;
  function rec(node: unknown): string {
    if (error) {
      return error;
    }
    if (typeof node === "string") {
      return node;
    }
    if (typeof node === "object" && node) {
      if ("children" in node && Array.isArray(node.children)) {
        return node.children.map(rec).join(" ");
      } else if ("tag" in node && typeof node.tag === "string") {
        return "";
      }
    }
    error = "Invalid richtext node: " + JSON.stringify(node);
    return JSON.stringify(node);
  }
  const value = source.map(rec).join(" ");
  if (error) {
    return { status: "error", error };
  } else {
    return { status: "ok", value };
  }
}
