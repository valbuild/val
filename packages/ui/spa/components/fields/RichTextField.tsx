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
import { ValidationErrors } from "../../components/ValidationError";
import {
  ShallowSource,
  useAddPatch,
  useSchemaAtPath,
  useSchemas,
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
}: {
  path: SourcePath;
  autoFocus?: boolean; // TODO: implement autoFocus
}) {
  const type = "richtext";
  const config = useValConfig();
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const schemas = useSchemas();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const {
    patchPath,
    addPatch,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  } = useAddPatch(path);

  const maybeClientSideOnly =
    "clientSideOnly" in sourceAtPath && sourceAtPath.clientSideOnly;

  useEffect(() => {
    if (maybeClientSideOnly === false && currentSourceData) {
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

  const imageReferencedModule = imageSchema?.referencedModule;
  const imageAcceptOptions = useMemo(() => {
    if (!hasImageEnabled) return undefined;
    if (imageSchema?.options?.accept) return imageSchema.options.accept;
    if (imageReferencedModule && schemas.status === "success") {
      const moduleSchema =
        schemas.data[imageReferencedModule as ModuleFilePath];
      if (moduleSchema?.type === "record" && moduleSchema.accept) {
        return moduleSchema.accept;
      }
    }
    return undefined;
  }, [hasImageEnabled, imageSchema, imageReferencedModule, schemas]);

  const imageModuleDirectory = useMemo(() => {
    if (!imageReferencedModule || schemas.status !== "success")
      return undefined;
    const moduleSchema = schemas.data[imageReferencedModule as ModuleFilePath];
    return moduleSchema?.type === "record" ? moduleSchema.directory : undefined;
  }, [imageReferencedModule, schemas]);

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

  const imageDirectory = imageModuleDirectory ?? config?.files?.directory;

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
          imageDirectory,
          !!imageReferencedModule,
        );

        if (patch.length === 0) return null;

        const refFromPatch =
          patch[0] &&
          "value" in patch[0] &&
          typeof patch[0].value === "object" &&
          patch[0].value !== null &&
          "_ref" in patch[0].value
            ? (patch[0].value._ref as string)
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
    imageDirectory,
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

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const doc = editorRef.current?.getDocument();
      if (!doc) return;

      const patch = createRichTextPatch(patchPath, doc);
      sourceRef.current = doc;
      addPatch(patch, "richtext");
    }, DEBOUNCE_MS);
  }, [patchPath, addPatch]);

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
      <ValidationErrors path={path} />
      <RichTextEditor
        ref={editorRef}
        features={features}
        linkCatalog={linkCatalog}
        readOnly={disabledRef.current}
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
