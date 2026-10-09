import type { ReactNode } from "react";
import { ExternalLink, FileText, Trash2, X } from "lucide-react";
import { Internal } from "@valbuild/core";
import { Input } from "../designSystem/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { FilenameInput } from "../FileGallery/FilenameInput";
import { FieldValidationError } from "../FieldValidationError";
import { HotspotMarker } from "../fields/HotspotMarker";
import { VideoPlayer } from "../fields/VideoPlayer";
import { FontSpecimen } from "../FontPreview";
import { factsOf, typeLabel } from "./format";
import type { MediaItem, MediaKind } from "./types";

/** Everything about ONE open entry, as plain values and callbacks. */
export type MediaInspectorProps = {
  kind: MediaKind;
  item: MediaItem;
  onClose: () => void;
  /** Nothing can be changed: no rename, description or delete. */
  readonly?: boolean;
  /**
   * Replaces the default preview: the Studio's player, which the defaults
   * editor takes frames and times from, or an image's focal-point picker.
   */
  preview?: ReactNode;
  onDescriptionChange?: (description: string) => void;
  /** Beside the description's label: who changed it. */
  descriptionAside?: ReactNode;
  /**
   * The rest of what an entry holds for the fields that pick it — a video's
   * poster, times, focal point and captions — below the description. A video
   * passes its description in here too (`hideDescription`), because the same
   * controls edit a video field.
   */
  defaults?: ReactNode;
  hideDescription?: boolean;
  /** Resolves to an error message, or null when it was renamed. */
  onRename?: (newBase: string) => Promise<string | null>;
  /** e.g. "Renaming updates the 2 places using it." */
  renameNote?: string | null;
  renameDisabled?: boolean;
  /** Where the entry is used. */
  usage?: ReactNode;
  onDelete?: () => void;
  /** Why it cannot be deleted now, or null when it can. */
  deleteBlockedReason?: string | null;
  /** More actions beside Open, e.g. the Studio's Compare link. */
  extraActions?: ReactNode;
};

/**
 * The entry that is open, beside the grid rather than over it: an editor
 * going through a gallery clicks from one entry to the next, and a dialog in
 * the way of the grid made every step two clicks.
 *
 * The top is the one part that differs by kind — the image with its focal
 * point, the video in a real player (an HLS stream too), a font set in
 * itself, any other file's type — and
 * everything under it is the same in every gallery.
 */
export function MediaInspector({
  kind,
  item,
  onClose,
  readonly,
  preview,
  onDescriptionChange,
  descriptionAside,
  defaults,
  hideDescription,
  onRename,
  renameNote,
  renameDisabled,
  usage,
  onDelete,
  deleteBlockedReason,
  extraActions,
}: MediaInspectorProps) {
  const blocked = deleteBlockedReason ?? null;
  return (
    // The name and the actions stay where they are; what is between them
    // scrolls. A panel that scrolled whole took Delete and Open off screen
    // along with the heading that says which entry they act on.
    <aside
      aria-label={`${item.name} details`}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-secondary px-4 pb-2 pt-3">
        <h3 className="truncate text-sm font-semibold text-fg-primary">
          {item.name}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-3">
          {preview ?? <Preview kind={kind} item={item} />}
          <p className="mt-2 text-xs text-fg-secondary">{factsOf(item)}</p>
          {item.errors && item.errors.length > 0 && (
            // Paths have no spaces to break at, and they are most of a message.
            <div className="mt-2 [overflow-wrap:anywhere]">
              <FieldValidationError
                validationErrors={item.errors.map((message) => ({ message }))}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          {onRename && !readonly && (
            <Labelled label="Name">
              <FilenameInput
                filename={item.name}
                disabled={renameDisabled}
                onSave={(_newFilename, newBase) => onRename(newBase)}
              />
              {renameNote && (
                <p className="px-2 text-[0.6875rem] text-fg-secondary-alt">
                  {renameNote}
                </p>
              )}
            </Labelled>
          )}

          {kind !== "files" && !hideDescription && (
            <Labelled label="Description" aside={descriptionAside}>
              <Input
                key={item.ref}
                value={item.description ?? ""}
                disabled={readonly || !onDescriptionChange}
                placeholder={
                  kind === "videos"
                    ? "What happens in the video..."
                    : "Describe this image..."
                }
                // Written as it is typed, as every text field in the Studio is:
                // the patch store folds the keystrokes into one change.
                onChange={(ev) => onDescriptionChange?.(ev.target.value)}
                className="h-8 text-sm"
              />
              {item.descriptionErrors && item.descriptionErrors.length > 0 && (
                <FieldValidationError
                  validationErrors={item.descriptionErrors.map((message) => ({
                    message,
                  }))}
                />
              )}
            </Labelled>
          )}

          {defaults && <div className="flex flex-col gap-5">{defaults}</div>}

          {usage && <Labelled label="Used in">{usage}</Labelled>}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-secondary px-4 py-3">
        {/*
         * An anchor, not a button calling `window.open`: a middle click, a
         * modifier click and "Copy link address" all work on it.
         */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-bg-secondary px-3 py-1.5 text-xs font-medium text-fg-primary hover:bg-bg-tertiary"
        >
          <ExternalLink size={14} />
          Open
        </a>
        {extraActions}
        {onDelete && !readonly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto">
                <button
                  type="button"
                  disabled={blocked !== null}
                  onClick={onDelete}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-fg-error-primary hover:bg-bg-error-primary disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </span>
            </TooltipTrigger>
            {blocked && <TooltipContent>{blocked}</TooltipContent>}
          </Tooltip>
        )}
      </div>
    </aside>
  );
}

function Preview({ kind, item }: { kind: MediaKind; item: MediaItem }) {
  if (kind === "videos") {
    return (
      <VideoPlayer
        key={item.ref}
        src={item.url}
        isHls={!!item.isHls}
        poster={item.thumbnailUrl}
        className="aspect-video w-full rounded-md bg-black object-contain"
      />
    );
  }
  if (kind === "images") {
    return (
      <div className="relative overflow-hidden rounded-md bg-bg-tertiary">
        <img
          src={item.url}
          alt={item.description ?? item.name}
          className="max-h-72 w-full object-contain"
        />
        {item.hotspot && <HotspotMarker hotspot={item.hotspot} />}
      </div>
    );
  }
  if (Internal.isFontMimeType(item.mimeType)) {
    return <FontSpecimen key={item.ref} url={item.url} variant="inspector" />;
  }
  return (
    <div className="grid aspect-[4/3] place-items-center rounded-md bg-bg-tertiary">
      <div className="flex flex-col items-center gap-2 text-fg-secondary">
        <FileText size={40} strokeWidth={1.25} />
        <span className="text-xs font-semibold tracking-wide">
          {typeLabel(item)}
        </span>
      </div>
    </div>
  );
}

function Labelled({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-fg-secondary">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}
