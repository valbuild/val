import * as React from "react";
import {
  FileMetadata,
  ImageMetadata,
  Internal,
  SourcePath,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue, Patch } from "@valbuild/core/patch";
import {
  useAddPatch,
  useFilePatchIds,
  useSchemaAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import { useAllValidationErrors } from "../ValErrorProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { ValidationErrors } from "../ValidationError";
import { FieldLoading } from "../FieldLoading";
import { FileGallery } from "../FileGallery/FileGallery";
import type { GalleryFile } from "../FileGallery/types";
import { readImage } from "../../utils/readImage";
import { readFile } from "../../utils/readFile";

function refToUrl(
  filePath: string,
  filePatchIds: ReadonlyMap<string, string>,
): string {
  const patchId = filePatchIds.get(filePath);
  if (patchId) {
    return filePath.startsWith("/public")
      ? `/api/val/files${filePath}?patch_id=${patchId}`
      : `${filePath}?patch_id=${patchId}`;
  }
  return filePath.startsWith("/public")
    ? filePath.slice("/public".length)
    : filePath;
}

export function ModuleGallery({
  path,
  showChildPath: showChild,
}: {
  path: SourcePath;
  showChildPath?: SourcePath;
}) {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const source = useSourceAtPath(path);
  const schemaAtPath = useSchemaAtPath(path);
  const filePatchIds = useFilePatchIds();
  const { addPatch, patchPath, addAndUploadPatchWithFileOps } =
    useAddPatch(path);
  const allValidationErrors = useAllValidationErrors() || {};

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const rawSource =
    source.status === "success"
      ? (source.data as Record<string, Record<string, unknown>> | null)
      : null;

  const schema =
    schemaAtPath.status === "success" && schemaAtPath.data.type === "record"
      ? schemaAtPath.data
      : null;

  const imageMode = schema?.mediaType === "images";
  const directory = schema?.directory ?? "/public/val";
  const accept = schema?.accept;

  const files: GalleryFile[] = rawSource
    ? Object.entries(rawSource).map(([ref, meta]) => {
        const mimeType = typeof meta.mimeType === "string" ? meta.mimeType : "";
        const width = typeof meta.width === "number" ? meta.width : 0;
        const height = typeof meta.height === "number" ? meta.height : 0;
        const alt = typeof meta.alt === "string" ? meta.alt : undefined;
        const itemPath = sourcePathOfItem(path, ref);
        const genericValidationErrors = [];
        const altSpecificValidationErrors = [];
        for (const [errPath, errs] of Object.entries(allValidationErrors)) {
          if (!errPath.startsWith(itemPath)) {
            continue;
          }
          if (errPath === Internal.createValPathOfItem(itemPath, "alt")) {
            altSpecificValidationErrors.push(...errs.map((err) => err.message));
          } else {
            genericValidationErrors.push(...errs.map((err) => err.message));
          }
        }

        return {
          ref,
          url: refToUrl(ref, filePatchIds),
          filename: ref.split("/").pop() || ref,
          folder: ref.substring(0, ref.lastIndexOf("/")),
          metadata: { mimeType, width, height, alt },
          fieldSpecificErrors: {
            alt:
              altSpecificValidationErrors.length > 0
                ? altSpecificValidationErrors
                : undefined,
          },
          validationErrors:
            genericValidationErrors.length > 0
              ? genericValidationErrors
              : undefined,
        };
      })
    : [];

  const handleFileDelete = React.useCallback(
    (index: number) => {
      if (!rawSource) return;
      const ref = Object.keys(rawSource)[index];
      if (!ref) return;
      const patch: Patch = [
        {
          op: "remove",
          path: [...patchPath, ref] as unknown as array.NonEmptyArray<string>,
        },
        {
          op: "file",
          path: [...patchPath, ref],
          filePath: ref,
          value: null,
          remote: false,
        },
      ];
      setUploading(true);
      addAndUploadPatchWithFileOps(
        patch,
        imageMode ? "image" : "file",
        (msg) => setUploadError(msg),
        () => {},
      ).finally(() => setUploading(false));
    },
    [rawSource, patchPath, imageMode, addAndUploadPatchWithFileOps],
  );

  const handleAltTextChange = React.useCallback(
    (index: number, newAltText: string) => {
      if (!rawSource) return;
      const ref = Object.keys(rawSource)[index];
      if (!ref) return;
      const patch: Patch = [
        {
          op: "replace",
          path: [...patchPath, ref, "alt"],
          value: newAltText,
        },
      ];
      addPatch(patch, "record");
    },
    [rawSource, patchPath, addPatch],
  );

  const handleUpload = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setUploadError(null);
      if (imageMode) {
        readImage(ev)
          .then(async (res) => {
            if (!res.width || !res.height || !res.mimeType) return;
            const metadata: ImageMetadata = {
              width: res.width,
              height: res.height,
              mimeType: res.mimeType,
            };
            const newFilename = Internal.createFilename(
              res.src,
              res.filename ?? null,
              metadata,
              res.fileHash,
            );
            if (!newFilename) return;
            const filePath = `${directory}/${newFilename}`;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, filePath],
                value: {
                  width: metadata.width,
                  height: metadata.height,
                  mimeType: metadata.mimeType,
                  alt: null, // default alt for new uploads
                } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, filePath],
                filePath,
                value: res.src,
                metadata,
                remote: false,
              },
            ];
            setUploading(true);
            await addAndUploadPatchWithFileOps(
              patch,
              "image",
              (msg) => setUploadError(msg),
              () => {},
            );
          })
          .catch(() =>
            setUploadError("Could not upload image. Please try again."),
          )
          .finally(() => setUploading(false));
      } else {
        readFile(ev)
          .then(async (res) => {
            if (!res.mimeType) return;
            const metadata: FileMetadata = { mimeType: res.mimeType };
            const newFilename = Internal.createFilename(
              res.src,
              res.filename ?? null,
              metadata,
              res.fileHash,
            );
            if (!newFilename) return;
            const filePath = `${directory}/${newFilename}`;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, filePath],
                value: { mimeType: metadata.mimeType } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, filePath],
                filePath,
                value: res.src,
                metadata,
                remote: false,
              },
            ];
            setUploading(true);
            await addAndUploadPatchWithFileOps(
              patch,
              "file",
              (msg) => setUploadError(msg),
              () => {},
            );
          })
          .catch(() =>
            setUploadError("Could not upload file. Please try again."),
          )
          .finally(() => setUploading(false));
      }
      ev.target.value = "";
    },
    [imageMode, directory, patchPath, addAndUploadPatchWithFileOps],
  );

  const showChildRef = React.useMemo(() => {
    if (!showChild) return null;
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(showChild);
    const childKey = Internal.splitModulePath(modulePath)[0];
    if (typeof childKey !== "string") return null;
    return childKey;
  }, [showChild]);

  if (source.status !== "success") {
    return <FieldLoading path={path} type="record" />;
  }

  return (
    <div id={path}>
      <ValidationErrors path={path} />
      {uploadError && (
        <div className="mb-2 rounded p-3 bg-bg-error-primary text-fg-error-primary text-sm">
          {uploadError}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        onChange={handleUpload}
      />
      <FileGallery
        files={files}
        parentPath={moduleFilePath}
        imageMode={imageMode}
        onAltTextChange={imageMode ? handleAltTextChange : undefined}
        onFileDelete={handleFileDelete}
        onUploadClick={() => inputRef.current?.click()}
        uploading={uploading}
        defaultOpenFileRef={showChildRef ?? undefined}
      />
    </div>
  );
}
