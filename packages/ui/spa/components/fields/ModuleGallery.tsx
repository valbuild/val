import * as React from "react";
import {
  FileMetadata,
  ImageMetadata,
  Internal,
  SerializedFileSchema,
  SerializedImageSchema,
  SourcePath,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue, Patch } from "@valbuild/core/patch";
import {
  useAddPatch,
  useFilePatchIds,
  useSchemaAtPath,
  useSourceAtPath,
  useValConfig,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import {
  usePendingPatchesForModule,
  useProfilesByAuthorId,
} from "../ValProvider";
import { useAllValidationErrors } from "../ValErrorProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { getRefParts } from "../../utils/getFilenameFromRef";
import { FieldLoading } from "../FieldLoading";
import { Progress } from "../designSystem/progress";
import { FileGallery } from "../FileGallery/FileGallery";
import type { GalleryFile } from "../FileGallery/types";
import { readImage, readImageFromFile } from "../../utils/readImage";
import type { ReadImageEncode } from "../../utils/readImage";
import { resolveEncodeSettings } from "../../utils/encodeImage";
import { readFile, readFileFromFile } from "../../utils/readFile";
import { getFileExt } from "../../utils/getFileExt";
import { refToUrl } from "../MediaPicker/refToUrl";
import { useUploadRequest } from "../UploadRequest";

const textEncoder = new TextEncoder();

export function ModuleGallery({
  path,
  showChildPath: showChild,
  readonly,
}: {
  path: SourcePath;
  showChildPath?: SourcePath;
  /**
   * `s.images().readonly()` — look, do not touch.
   *
   * The gallery had no notion of it at all, so a readonly module still offered
   * upload, delete and alt text, and every one of them wrote a patch. The three
   * handlers are simply withheld: `FileGallery` already hides an action it was
   * given no handler for, which is better than a disabled button that invites a
   * click and then explains itself.
   */
  readonly?: boolean;
}) {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const source = useSourceAtPath(path);
  const schemaAtPath = useSchemaAtPath(path);
  const filePatchIds = useFilePatchIds();
  const { addPatch, patchPath, addAndUploadPatchWithFileOps } =
    useAddPatch(path);
  const allModulePatches = usePendingPatchesForModule(moduleFilePath);
  const profilesByAuthorIds = useProfilesByAuthorId();
  const allValidationErrors = useAllValidationErrors() || {};

  const config = useValConfig();
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();

  const inputRef = React.useRef<HTMLInputElement>(null);
  /**
   * The Media panel can ask this gallery to open its file dialog.
   *
   * The panel knows which gallery you meant; only this component knows how to
   * upload into one — the ref from the hash and the directory, local or remote,
   * the metadata entry and the file op as one patch. So the panel asks and this
   * answers, rather than the upload existing twice.
   */
  useUploadRequest(moduleFilePath, () => inputRef.current?.click());
  const dragCounterRef = React.useRef(0);
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [progressPercentage, setProgressPercentage] = React.useState<
    number | null
  >(null);

  const handleProgress = React.useCallback(
    (
      bytesUploaded: number,
      totalBytes: number,
      currentFile: number,
      totalFiles: number,
    ) => {
      const pct = Math.round(
        ((currentFile * totalBytes + bytesUploaded) /
          (totalFiles * totalBytes)) *
          100,
      );
      setProgressPercentage(pct);
      if (pct === 100) {
        setTimeout(() => {
          setProgressPercentage(null);
        }, 1000);
      }
    },
    [],
  );

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
  /**
   * A gallery has no field to override it, so the gallery's own option is the
   * whole answer. Passed to both upload paths: the file input and the drop
   * loop are separate code, and a fix to one has never reached the other.
   */
  const encode = React.useMemo<ReadImageEncode>(
    () => ({
      settings: resolveEncodeSettings(undefined, schema?.encode),
      accept,
    }),
    [schema, accept],
  );

  const requireRemote = schema?.remote;
  const remoteData =
    schema?.remote &&
    remoteFiles.status === "ready" &&
    currentRemoteFileBucket &&
    config
      ? {
          publicProjectId: remoteFiles.publicProjectId,
          bucket: currentRemoteFileBucket,
          coreVersion: remoteFiles.coreVersion,
          remoteHost: config.remoteHost,
        }
      : null;

  /**
   * Whether an upload can succeed RIGHT NOW.
   *
   * A remote gallery cannot upload until `/remote/settings` has answered and a
   * bucket has been picked from it - which is several async hops after intake:
   * schemas arrive, that sets `requiresRemoteFiles`, that fires the request, and
   * `useCurrentRemoteFileBucket` picks a bucket in an effect after the response.
   * Until then `remoteData` is null and `handleUpload` can only refuse.
   *
   * Exposed so the button is not offered before it can work. It is also the only
   * signal anything outside this component can wait on - `remoteFiles` and the
   * bucket are both context state with no DOM of their own - which is what
   * `e2e/http/remoteFiles.spec.ts` waits for instead of racing the request.
   */
  const canUpload = !requireRemote || remoteData !== null;
  /** Loading is transient and about to resolve; inactive is a real failure. */
  const remoteSettingsPending =
    requireRemote === true &&
    (remoteFiles.status === "loading" || remoteFiles.status === "not-asked");

  const files: GalleryFile[] = rawSource
    ? Object.entries(rawSource).map(([ref, meta]) => {
        const mimeType = typeof meta.mimeType === "string" ? meta.mimeType : "";
        const width = typeof meta.width === "number" ? meta.width : 0;
        const height = typeof meta.height === "number" ? meta.height : 0;
        const alt = typeof meta.alt === "string" ? meta.alt : undefined;
        const hotspot =
          typeof meta.hotspot === "object" &&
          meta.hotspot !== null &&
          "x" in (meta.hotspot as Record<string, unknown>) &&
          "y" in (meta.hotspot as Record<string, unknown>) &&
          typeof (meta.hotspot as Record<string, unknown>).x === "number" &&
          typeof (meta.hotspot as Record<string, unknown>).y === "number"
            ? {
                x: (meta.hotspot as { x: number }).x,
                y: (meta.hotspot as { y: number }).y,
              }
            : undefined;
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

        const fileModulePath = Internal.patchPathToModulePath([
          ...patchPath,
          ref,
        ]);
        const filePatches = allModulePatches.filter((patch) =>
          patch.patch.some(
            (op) => Internal.patchPathToModulePath(op.path) === fileModulePath,
          ),
        );
        const filePatchesByAuthorIds: Record<
          string,
          (typeof allModulePatches)[number][]
        > = {};
        for (const patch of filePatches) {
          const author = patch.authorId ?? "unknown";
          if (!filePatchesByAuthorIds[author]) {
            filePatchesByAuthorIds[author] = [];
          }
          filePatchesByAuthorIds[author].push(patch);
        }

        const { filename, folder } = getRefParts(ref);

        return {
          ref,
          url: refToUrl(ref, filePatchIds),
          filename,
          folder,
          metadata: { mimeType, width, height, alt, hotspot },
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
          patchesByAuthorIds: filePatchesByAuthorIds,
          profilesByAuthorIds,
          sourcePath: itemPath,
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
          remote: Internal.remote.splitRemoteRef(ref).status === "success",
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
          // "add", not "replace": on an object key the two mean the same thing,
          // but "add" also works when the key is absent by the time the patch is
          // applied - e.g. the entry was re-uploaded with fresh metadata.
          op: "add",
          path: [...patchPath, ref, "alt"],
          value: newAltText,
        },
      ];
      addPatch(patch, "record");
    },
    [rawSource, patchPath, addPatch],
  );

  const computeRef = React.useCallback(
    (
      res: {
        fileHash: string;
        src: string;
        filename?: string;
      },
      syntheticSchema: SerializedImageSchema | SerializedFileSchema,
      metadata: Record<string, unknown> | undefined,
    ):
      | {
          status: "success";
          ref: string;
          isRemote: boolean;
        }
      | {
          status: "error";
          error: string;
        } => {
      const newFilename = Internal.createFilename(
        res.src,
        res.filename ?? null,
        metadata,
        res.fileHash,
      );
      if (!newFilename) {
        return {
          status: "error",
          error: "Failed to create filename for the uploaded file.",
        };
      }
      const filePath = `${directory}/${newFilename}`;
      let ref: string;
      let isRemote: boolean;
      if (requireRemote) {
        if (!remoteData) {
          return {
            status: "error",
            error:
              "Remote uploads are not available. Please try again later. This could be a temporary issue with the Val server. If the problem persists, please contact support.",
          };
        }
        const remoteFileHash = Internal.remote.hashToRemoteFileHash(
          res.fileHash,
        );
        const validationHash = Internal.remote.getValidationHash(
          remoteData.coreVersion,
          syntheticSchema,
          getFileExt(newFilename),
          metadata,
          remoteFileHash,
          textEncoder,
        );
        ref = Internal.remote.createRemoteRef(remoteData.remoteHost, {
          publicProjectId: remoteData.publicProjectId,
          coreVersion: remoteData.coreVersion,
          bucket: remoteData.bucket,
          validationHash,
          fileHash: remoteFileHash,
          filePath:
            `${directory.slice(1)}/${newFilename}` as `public/${string}`,
        });
        isRemote = true;
      } else {
        ref = filePath;
        isRemote = false;
      }
      return {
        status: "success",
        ref,
        isRemote,
      };
    },
    [directory, requireRemote, remoteData],
  );

  const handleUpload = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setUploadError(null);
      if (requireRemote && (!remoteData || !currentRemoteFileBucket)) {
        if (!currentRemoteFileBucket) {
          /**
           * Still loading is NOT the same as unavailable.
           *
           * Both used to land on "contact support", so an editor quick enough to
           * pick a file while `/remote/settings` was still in flight was told
           * their upload had failed permanently - for a state that resolves in
           * milliseconds. The button is disabled until `canUpload`, so this is
           * now only reachable by something that bypasses it (a drop, or a test
           * driving the hidden input), and it says what is actually true.
           */
          if (remoteSettingsPending) {
            setUploadError("Preparing remote uploads - try again in a moment.");
            ev.target.value = "";
            return;
          }
          console.error("Current remote file bucket is not available", {
            remoteFiles,
            currentRemoteFileBucket,
          });
          setUploadError(
            "Remote uploads are not available. Please try again later. Val server responded with result, but no remote file buckets were available. This could be a temporary issue with the Val server. If the problem persists, please contact support.",
          );
          ev.target.value = "";
          return;
        }
        setUploadError(
          "Remote uploads are not available. Please try again later.",
        );
        ev.target.value = "";
        return;
      }
      if (imageMode) {
        readImage(ev, encode)
          .then(async (res) => {
            if (!res.width || !res.height || !res.mimeType) return;
            const metadata: ImageMetadata = {
              width: res.width,
              height: res.height,
              mimeType: res.mimeType,
            };
            const refRes = computeRef(
              res,
              {
                type: "image",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              return;
            }
            const { ref, isRemote } = refRes;

            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: {
                  width: metadata.width,
                  height: metadata.height,
                  mimeType: metadata.mimeType,
                  alt: null, // default alt for new uploads
                } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            setUploading(true);
            await addAndUploadPatchWithFileOps(
              patch,
              "image",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          })
          .catch(() =>
            setUploadError("Could not upload image. Please try again."),
          )
          .finally(() => {
            setUploading(false);
            setProgressPercentage(null);
          });
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
            const refRes = computeRef(
              res,
              {
                type: "file",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              return;
            }
            const { ref, isRemote } = refRes;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: { mimeType: metadata.mimeType } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            setUploading(true);
            await addAndUploadPatchWithFileOps(
              patch,
              "file",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          })
          .catch(() =>
            setUploadError("Could not upload file. Please try again."),
          )
          .finally(() => {
            setUploading(false);
            setProgressPercentage(null);
          });
      }
      ev.target.value = "";
    },
    [
      imageMode,
      directory,
      patchPath,
      addAndUploadPatchWithFileOps,
      requireRemote,
      remoteData,
      currentRemoteFileBucket,
      schema,
      remoteFiles,
      encode,
      remoteSettingsPending,
    ],
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
      if (requireRemote && (!remoteData || !currentRemoteFileBucket)) {
        /**
         * Same distinction as `handleUpload`, and this is the path that needs
         * it most: a drop has no button to disable, so `canUpload` cannot keep
         * anyone out of here. Dropping a file while `/remote/settings` is still
         * in flight is the one way an editor can still meet this, and it is
         * transient - saying "not available" would be false.
         */
        setUploadError(
          remoteSettingsPending
            ? "Preparing remote uploads - try again in a moment."
            : "Remote uploads are not available. Please try again later.",
        );
        return;
      }
      const droppedFiles = Array.from(e.dataTransfer.files).filter((file) => {
        if (!accept) return true;
        return accept
          .split(",")
          .map((s) => s.trim())
          .some((pattern) => {
            if (pattern.endsWith("/*"))
              return file.type.startsWith(pattern.slice(0, -1));
            return file.type === pattern;
          });
      });
      if (droppedFiles.length === 0) return;
      setUploadError(null);
      setUploading(true);
      (async () => {
        for (const file of droppedFiles) {
          if (imageMode) {
            const res = await readImageFromFile(file, encode).catch(() => null);
            if (!res || !res.width || !res.height || !res.mimeType) continue;
            const metadata: ImageMetadata = {
              width: res.width,
              height: res.height,
              mimeType: res.mimeType,
            };
            const refRes = computeRef(
              res,
              {
                type: "image",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              continue;
            }
            const { ref, isRemote } = refRes;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: {
                  width: metadata.width,
                  height: metadata.height,
                  mimeType: metadata.mimeType,
                  alt: null,
                } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            await addAndUploadPatchWithFileOps(
              patch,
              "image",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          } else {
            const res = await readFileFromFile(file).catch(() => null);
            if (!res || !res.mimeType) continue;
            const metadata: FileMetadata = { mimeType: res.mimeType };
            const refRes = computeRef(
              res,
              {
                type: "file",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              continue;
            }
            const { ref, isRemote } = refRes;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: { mimeType: metadata.mimeType } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            await addAndUploadPatchWithFileOps(
              patch,
              "file",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          }
        }
      })().finally(() => {
        setUploading(false);
        setProgressPercentage(null);
      });
    },
    [
      imageMode,
      patchPath,
      addAndUploadPatchWithFileOps,
      requireRemote,
      remoteData,
      currentRemoteFileBucket,
      accept,
      schema,
      computeRef,
      handleProgress,
      encode,
      // Derived from `remoteFiles`, which is NOT otherwise a dependency here.
      // On loading -> inactive neither `remoteData` nor the bucket changes
      // (both stay null), so without this the flag stays stale at `true` and a
      // genuinely unavailable remote would keep saying "try again in a moment".
      remoteSettingsPending,
    ],
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
    <div
      id={path}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current++;
        setIsDraggingOver(true);
      }}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setIsDraggingOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {uploadError && (
        <div className="mb-2 rounded p-3 bg-bg-error-primary text-fg-error-primary text-sm">
          {uploadError}
        </div>
      )}
      {progressPercentage === null ? (
        <div className="h-[2px] mb-2" />
      ) : (
        <Progress
          className="h-[2px] mb-2 transition-opacity duration-300 z-[1000]"
          style={{ opacity: 1 }}
          value={progressPercentage ?? 0}
        />
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
        onAltTextChange={
          imageMode && !readonly ? handleAltTextChange : undefined
        }
        onFileDelete={readonly ? undefined : handleFileDelete}
        onUploadClick={readonly ? undefined : () => inputRef.current?.click()}
        uploadDisabled={!canUpload}
        uploading={uploading}
        defaultOpenFileRef={showChildRef ?? undefined}
        isDraggingOver={isDraggingOver}
      />
    </div>
  );
}
