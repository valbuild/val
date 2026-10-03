import { useEffect, useState } from "react";
import { ExternalLink, FileText, Trash2, X } from "lucide-react";
import { cn } from "../designSystem/cn";
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
import { factsOf, typeLabel } from "./format";
import type { MediaGalleryProps, MediaItem, MediaKind } from "./types";

/**
 * The entry that is open, beside the grid rather than over it: an editor
 * going through a gallery clicks from one entry to the next, and a dialog in
 * the way of the grid made every step two clicks.
 *
 * The top is the one part that differs by kind — the image with its focal
 * point, the video in a real player (an HLS stream too), a file's type — and
 * everything under it is the same in every gallery.
 */
export function MediaInspector({
  kind,
  item,
  onClose,
  onDescriptionChange,
  onRename,
  onDelete,
  deleteBlockedReason,
  renderUsage,
  readonly,
}: {
  kind: MediaKind;
  item: MediaItem;
  onClose: () => void;
} & Pick<
  MediaGalleryProps,
  | "onDescriptionChange"
  | "onRename"
  | "onDelete"
  | "deleteBlockedReason"
  | "renderUsage"
  | "readonly"
>) {
  const blocked = deleteBlockedReason?.(item) ?? null;
  return (
    <aside
      aria-label={`${item.name} details`}
      className="flex h-full min-h-0 flex-col overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
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

      <div className="px-4">
        <Preview kind={kind} item={item} />
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
              onSave={(_newFilename, newBase) => onRename(item.ref, newBase)}
            />
          </Labelled>
        )}

        {kind !== "files" && (
          <Labelled label="Description">
            <DescriptionInput
              key={item.ref}
              value={item.description ?? ""}
              readonly={readonly || !onDescriptionChange}
              placeholder={
                kind === "videos"
                  ? "What happens in the video…"
                  : "What the image shows…"
              }
              onCommit={(text) => onDescriptionChange?.(item.ref, text)}
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

        {renderUsage && (
          <Labelled label="Used in">{renderUsage(item)}</Labelled>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-border-secondary px-4 py-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-bg-secondary px-3 py-1.5 text-xs font-medium text-fg-primary hover:bg-bg-tertiary"
        >
          <ExternalLink size={14} />
          Open
        </a>
        {onDelete && !readonly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto">
                <button
                  type="button"
                  disabled={blocked !== null}
                  onClick={() => onDelete(item.ref)}
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-secondary">{label}</span>
      {children}
    </div>
  );
}

/**
 * Typed into freely, written when the editor leaves it or presses Enter — a
 * patch per keystroke would put one entry in the history per letter.
 */
function DescriptionInput({
  value,
  readonly,
  placeholder,
  onCommit,
}: {
  value: string;
  readonly?: boolean;
  placeholder: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      value={draft}
      disabled={readonly}
      placeholder={placeholder}
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") commit();
        if (ev.key === "Escape") setDraft(value);
      }}
      className={cn("h-8 text-sm")}
    />
  );
}
