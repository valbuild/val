import * as React from "react";
import {
  Internal,
  type ModuleFilePath,
  type SerializedVideoSchema,
  type SourcePath,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";
import { Button } from "../designSystem/button";
import { CompareLink } from "../CompareLink";
import { FieldPatchAuthors } from "../FieldPatchAuthors";
import { MediaInspector } from "../MediaGallery/MediaInspector";
import type { MediaItem, MediaKind } from "../MediaGallery/types";
import { ConnectedReferenceLinks } from "../ReferencesList";
import { useReferencedFiles } from "../useReferencedFiles";
import type { PendingPatch, Profile } from "../ValProvider";
import { useNavigation } from "../ValRouter";
import { FocalPointPicker } from "./FocalPointPicker";
import { VideoPlayer } from "./VideoPlayer";
import {
  effectiveChoices,
  toPosterUpload,
  VideoChoices,
  videoChoicesOf,
} from "./VideoChoices";
import {
  createPosterPatch,
  type RemoteUploadConfig,
} from "../../utils/video/createVideoPatch";
import { captureFrame, defaultPosterTime } from "../../utils/video/readVideo";

/** What the inspector needs to edit a video entry's defaults. */
export type VideoEntryEditing = {
  dir: string;
  /** Null for a local set, and for a remote one still waiting on settings. */
  remote: RemoteUploadConfig | null;
  /** True for a remote set: no poster is uploaded until `remote` is ready. */
  requireRemote: boolean;
  /** What the entry's posters and captions are hashed against. */
  schema: SerializedVideoSchema;
  /** For a patch with file ops; resolves when it is done, failed or not. */
  upload: (patch: Patch) => Promise<unknown>;
};

/**
 * Entries whose poster has been made — or tried — in this session, so a
 * poster that cannot be taken is not tried again on every render, and two
 * panels open on one entry do not each upload one.
 */
const posterAttempted = new Set<string>();

/**
 * The open entry of a gallery, with the Studio connected: where it is used,
 * who changed it, the Compare link, and — for a video — the defaults editor
 * with a real player beside it.
 *
 * `MediaInspector` stays plain values and callbacks, so it renders the same in
 * a story; everything that reads a store is here.
 */
export function GalleryEntryInspector({
  kind,
  item,
  entry,
  entryPatchPath,
  moduleFilePath,
  close,
  readonly,
  write,
  onDescriptionChange,
  onRename,
  onDelete,
  patchesByAuthorIds,
  profilesByAuthorIds,
  video,
  urlOf,
}: {
  kind: MediaKind;
  item: MediaItem;
  /** The entry's value as it is in the module. */
  entry: unknown;
  entryPatchPath: string[];
  moduleFilePath: ModuleFilePath;
  close: () => void;
  readonly?: boolean;
  write: (patch: Patch) => void;
  onDescriptionChange?: (description: string) => void;
  onRename?: (newBase: string) => Promise<string | null>;
  onDelete?: () => void;
  patchesByAuthorIds: Record<string, PendingPatch[]>;
  profilesByAuthorIds: Record<string, Profile>;
  /** Set for a video set: how its defaults are written. */
  video: VideoEntryEditing | null;
  urlOf: (media: { path: string; patch_id?: string }) => string;
}) {
  const references = useReferencedFiles(moduleFilePath, item.ref);
  const refs = references.refs;
  const referencesChecked = references.status === "success";
  const { navigate, currentSourcePath } = useNavigation();
  const [error, setError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const sourcePath = Internal.createValPathOfItem(
    moduleFilePath as string as SourcePath,
    item.ref,
  );
  const hasPatches = Object.keys(patchesByAuthorIds).length > 0;

  const own = videoChoicesOf(entry);
  const shown = effectiveChoices(own, null);

  /**
   * A video without a poster gets one the first time it is opened: the
   * frame the upload would have taken (a second in, or half of a shorter
   * one). Entries uploaded before posters were stored have none, and a stream
   * has no other picture — a tile cannot seek in one.
   */
  const canUploadPoster =
    !!video && !readonly && (!video.requireRemote || video.remote !== null);
  React.useEffect(() => {
    if (
      !video ||
      !canUploadPoster ||
      own.poster !== undefined ||
      typeof item.duration !== "number" ||
      posterAttempted.has(item.ref)
    ) {
      return;
    }
    posterAttempted.add(item.ref);
    const time = defaultPosterTime(item.duration);
    captureFrame(item.url, time, { isHls: item.isHls })
      .then(toPosterUpload)
      .then((poster) =>
        video.upload(
          createPosterPatch({
            patchPath: entryPatchPath,
            dir: video.dir,
            videoPath: item.ref,
            poster,
            posterTime: time,
            remote: video.remote,
            schema: video.schema,
          }),
        ),
      )
      .catch((err) => {
        // Not an error the editor has to act on: the poster can be taken
        // from the player below, and the gallery shows a frame without one.
        console.warn("Val: could not make a poster for", item.ref, err);
      });
    // Once per entry (`posterAttempted`): what it reads is the entry as it was
    // opened, and the poster landing must not start another.
  }, [item.ref, canUploadPoster]);

  const preview =
    kind === "videos" ? (
      <VideoPlayer
        key={item.ref}
        ref={videoRef}
        src={item.url}
        isHls={!!item.isHls}
        poster={shown.poster ? urlOf(shown.poster) : undefined}
        startTime={shown.startTime}
        endTime={shown.endTime}
        tracks={shown.captions?.map((track) => ({
          ...track,
          url: urlOf(track),
        }))}
        className="aspect-video w-full rounded-md bg-black object-contain"
        onError={setError}
      />
    ) : kind === "images" && !readonly ? (
      <FocalPointPicker
        url={item.url}
        hotspot={item.hotspot}
        alt={item.description ?? undefined}
        onChange={(hotspot) =>
          write([
            {
              op: "add",
              path: entryPatchPath.concat("hotspot"),
              value: hotspot,
            },
          ])
        }
      />
    ) : undefined;

  const defaults =
    kind === "videos" && video ? (
      <>
        {error && (
          <p role="alert" className="text-xs text-fg-error-primary">
            {error}
          </p>
        )}
        <VideoChoices
          idBase={sourcePath ?? (moduleFilePath as string as SourcePath)}
          own={own}
          patchPath={entryPatchPath}
          videoPath={item.ref}
          dir={video.dir}
          remote={video.remote}
          schema={video.schema}
          videoRef={videoRef}
          canCapture={canUploadPoster}
          urlOf={urlOf}
          disabled={!!readonly}
          write={write}
          upload={video.upload}
          onError={setError}
        />
      </>
    ) : kind === "images" && item.hotspot && !readonly ? (
      <div className="flex items-center justify-between gap-2 text-xs text-fg-secondary">
        <span>
          Focal point {Math.round(item.hotspot.x * 100)}%,{" "}
          {Math.round(item.hotspot.y * 100)}% — the default for every field
          using this image.
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const hotspotPath = entryPatchPath.concat("hotspot");
            if (array.isNonEmpty(hotspotPath)) {
              write([{ op: "remove", path: hotspotPath }]);
            }
          }}
        >
          Clear
        </Button>
      </div>
    ) : null;

  const places = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;
  return (
    <MediaInspector
      kind={kind}
      item={item}
      onClose={close}
      readonly={readonly}
      preview={preview}
      hideDescription={kind === "videos" && !!video}
      onDescriptionChange={onDescriptionChange}
      descriptionAside={
        hasPatches && (
          <FieldPatchAuthors
            patchesByAuthorIds={patchesByAuthorIds}
            profilesByAuthorIds={profilesByAuthorIds}
            sourcePath={sourcePath ?? undefined}
          />
        )
      }
      defaults={defaults}
      onRename={onRename}
      renameNote={
        refs.length > 0
          ? `Renaming updates the ${places(refs.length)} using it.`
          : null
      }
      renameDisabled={!referencesChecked}
      usage={
        refs.length > 0 ? (
          <ConnectedReferenceLinks
            refs={refs}
            currentPath={currentSourcePath}
            onSelect={(navPath, { scrollToPath }) =>
              navigate(navPath, { scrollToPath })
            }
          />
        ) : (
          <span className="text-xs italic text-fg-secondary-alt">
            {references.status === "loading"
              ? "Looking for where it is used…"
              : references.status === "error"
                ? "Could not look up where it is used."
                : "Not used yet."}
          </span>
        )
      }
      onDelete={onDelete}
      deleteBlockedReason={
        refs.length > 0
          ? `Cannot delete: used in ${places(refs.length)}`
          : references.status === "loading"
            ? `Checking references${references.percentage > 0 ? ` (${references.percentage}%)` : ""}…`
            : references.status === "error"
              ? "Cannot delete: references could not be checked"
              : null
      }
      extraActions={
        sourcePath && hasPatches ? (
          <CompareLink sourcePath={sourcePath} />
        ) : null
      }
    />
  );
}
