import { useEffect, useRef, useState } from "react";
import { FileText, Film, Loader2 } from "lucide-react";
import { cn } from "../designSystem/cn";
import { MediaThumbnail } from "../MediaThumbnail";
import { VideoPlayer } from "../fields/VideoPlayer";
import { formatDuration, typeLabel } from "./format";
import type { MediaItem, MediaKind, MediaUpload } from "./types";

/** How long a pointer rests on a video tile before it starts playing. */
const HOVER_DELAY_MS = 350;

/**
 * One entry as a tile: the picture, and on it what tells entries apart at a
 * glance — a video's length and whether it is a stream, a file's type.
 *
 * A video tile shows its stored still, and plays — muted, looping — while the
 * pointer rests on it, so an editor can tell two clips apart without opening
 * either. The player is mounted only then: a grid of streams must not load
 * hls.js and a segment per tile just by being on screen.
 */
export function MediaTile({
  kind,
  item,
  selected,
  onSelect,
}: {
  kind: MediaKind;
  item: MediaItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const isVideo = kind === "videos";
  const hasErrors = (item.errors?.length ?? 0) > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={() => {
        if (!isVideo) return;
        timer.current = setTimeout(() => setPlaying(true), HOVER_DELAY_MS);
      }}
      onPointerLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        setPlaying(false);
      }}
      aria-pressed={selected}
      title={hasErrors ? item.errors?.join("\n") : item.name}
      className={cn(
        "group flex min-w-0 flex-col gap-1.5 rounded-lg p-1.5 text-left",
        "transition-colors hover:bg-bg-secondary",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        selected && "bg-bg-secondary ring-2 ring-border-focus",
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-md bg-bg-tertiary",
          isVideo ? "aspect-video" : "aspect-square",
          hasErrors && "ring-2 ring-bg-error-primary",
        )}
      >
        <TilePicture kind={kind} item={item} playing={playing} />
        {isVideo && (
          <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-end justify-between gap-1">
            {item.isHls ? <Badge>HLS</Badge> : <span />}
            {typeof item.duration === "number" && (
              <Badge>{formatDuration(item.duration)}</Badge>
            )}
          </div>
        )}
        {kind === "files" && (
          <div className="pointer-events-none absolute bottom-1.5 right-1.5">
            <Badge>{typeLabel(item)}</Badge>
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-xs font-medium text-fg-primary">
          {item.name}
        </p>
        <p
          className={cn(
            "truncate text-[0.6875rem]",
            item.description
              ? "text-fg-secondary"
              : "italic text-fg-secondary-alt",
          )}
        >
          {item.description || "No description"}
        </p>
      </div>
    </button>
  );
}

function TilePicture({
  kind,
  item,
  playing,
}: {
  kind: MediaKind;
  item: MediaItem;
  playing: boolean;
}) {
  if (kind === "images") {
    return (
      <MediaThumbnail
        url={item.url}
        alt={item.description ?? item.name}
        hotspot={item.hotspot}
        loading="lazy"
        className="h-full w-full"
      />
    );
  }
  if (kind === "videos") {
    return (
      <>
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : item.isHls ? (
          // A stream with no stored still: nothing to show until hovered.
          <span className="grid h-full w-full place-items-center">
            <Film size={22} className="text-fg-secondary-alt" />
          </span>
        ) : (
          // A file with no stored still: one frame in, past the black ones.
          <video
            src={`${item.url}#t=1`}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}
        {playing && (
          <VideoPlayer
            preview
            src={item.url}
            isHls={!!item.isHls}
            className="absolute inset-0 h-full w-full bg-black object-cover"
          />
        )}
      </>
    );
  }
  return (
    <span className="grid h-full w-full place-items-center">
      <FileText size={28} className="text-fg-secondary-alt" />
    </span>
  );
}

/** A file still coming in, where it will be once it is an entry. */
export function UploadTile({
  kind,
  upload,
}: {
  kind: MediaKind;
  upload: MediaUpload;
}) {
  const label =
    upload.phase === "reading"
      ? "Reading…"
      : upload.phase === "converting"
        ? "Converting"
        : "Uploading";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-1.5" aria-busy="true">
      <div
        className={cn(
          "relative grid w-full place-items-center overflow-hidden rounded-md border border-dashed border-border-primary bg-bg-secondary",
          kind === "videos" ? "aspect-video" : "aspect-square",
        )}
      >
        <div className="flex flex-col items-center gap-1 text-fg-secondary">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-[0.6875rem]">
            {label}
            {upload.progress !== null ? ` ${upload.progress}%` : ""}
          </span>
        </div>
        {upload.progress !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-bg-tertiary">
            <div
              className="h-full bg-bg-brand-primary transition-[width]"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
        )}
      </div>
      <p className="truncate px-0.5 text-xs text-fg-secondary">{upload.name}</p>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded bg-black/70 px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide text-white">
      {children}
    </span>
  );
}
