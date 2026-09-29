import { DragEvent, ReactNode, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { cn } from "../designSystem/cn";
import { MediaThumbnail, mayBeTransparent } from "../MediaThumbnail";

/**
 * The image an image field holds, shown the way a page would show it.
 *
 * A 16:9 crop centred on the focal point, as big as the field allows, with the
 * file's particulars under it. It replaced a 120px thumbnail beside the file
 * name: that answered "which file" and left "what does the page get" to the
 * large preview, and the second question is the one an editor is asking.
 *
 * The controls float over the picture on hover, and are there permanently on
 * a device that cannot hover and whenever focus is inside the card — hover-only
 * controls are controls a keyboard and a phone never reach. The picture itself
 * is a button that opens it large; the toolbar is its SIBLING, not its child,
 * because a button inside a button is not a thing HTML allows.
 *
 * Files are accepted by drop, full or empty. Empty, the card is a drop zone
 * that says so; full, dragging a file over it says it will replace the image.
 * What happens to the dropped file is the caller's: this only hands it over.
 *
 * `compact` is for where there are many of these, or little room: an inline
 * list (`BlockList` passes `compact` to every field of every block), the
 * canvas side panel, the overlay. A list of ten images was ten full-width cards
 * tall. Compact keeps everything but the size — the same focal-point crop, the
 * drop, the progress bar, the checkerboard — in a 160×90 picture with the name
 * and the controls BESIDE it rather than over it, because at that size a
 * toolbar on the picture would cover most of it.
 */
export function ImageCard({
  url,
  alt,
  hotspot,
  name,
  detail,
  mimeType,
  uploading,
  progressPercentage,
  onOpenPreview,
  actions,
  emptyActions,
  onDropFile,
  dropDisabled,
  compact,
}: {
  /** Resolved URL of the image, or null when the field is empty. */
  url: string | null;
  alt?: string;
  hotspot?: { x: number; y: number };
  /** The file's name, e.g. `hero-mountains_a1b2c.jpg`. */
  name: string | null;
  /** Dimensions, type, focal point — whatever is known. */
  detail: string | null;
  /** Decides whether the checkerboard is drawn. */
  mimeType?: string;
  uploading?: boolean;
  progressPercentage?: number | null;
  onOpenPreview?: () => void;
  /** Floated over the image: replace, remove, whatever the field offers. */
  actions: ReactNode;
  /** Inside the empty drop zone: the ways to choose a file. */
  emptyActions: ReactNode;
  onDropFile?: (file: File) => void;
  dropDisabled?: boolean;
  /** Smaller, with the controls beside the picture. See above. */
  compact?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const canDrop = !!onDropFile && !dropDisabled;
  const dropHandlers = canDrop
    ? {
        onDragOver: (ev: DragEvent) => {
          if (!ev.dataTransfer.types.includes("Files")) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        },
        onDragLeave: (ev: DragEvent) => {
          // Leaving for a child is not leaving the card.
          const next = ev.relatedTarget;
          if (next instanceof Node && ev.currentTarget.contains(next)) return;
          setDragOver(false);
        },
        onDrop: (ev: DragEvent) => {
          ev.preventDefault();
          setDragOver(false);
          const file = ev.dataTransfer.files?.[0];
          if (file) onDropFile?.(file);
        },
      }
    : {};
  const progress = uploading && (
    <UploadProgress progressPercentage={progressPercentage ?? null} />
  );
  const uploadingLabel = progressPercentage
    ? `Uploading… ${progressPercentage}%`
    : "Uploading…";
  const picture = url && (
    <button
      type="button"
      onClick={onOpenPreview}
      disabled={!onOpenPreview}
      aria-label="View image"
      className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus disabled:cursor-default"
    >
      <MediaThumbnail
        url={url}
        alt={alt}
        hotspot={hotspot}
        checkerboard={mayBeTransparent(mimeType)}
      />
    </button>
  );
  const dropOverlay = dragOver && (
    <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg-primary)_70%,transparent)] backdrop-blur-sm">
      <span className="flex items-center gap-1.5 text-xs font-medium text-fg-primary">
        <Upload size={14} />
        {compact ? "Replace" : "Drop to replace"}
      </span>
    </div>
  );

  if (compact) {
    return (
      <div
        {...dropHandlers}
        className={cn(
          "relative flex w-full gap-3 overflow-hidden rounded-lg transition-colors",
          !url && "border border-dashed p-3",
          !url &&
            (dragOver
              ? "border-border-focus bg-bg-secondary"
              : "border-border-primary"),
        )}
      >
        {url ? (
          <div className="relative h-[5.625rem] w-40 shrink-0 overflow-hidden rounded-md border border-border-primary bg-bg-secondary">
            {picture}
            {dropOverlay}
            {progress}
          </div>
        ) : (
          <ImagePlus
            size={18}
            strokeWidth={1.5}
            className="mt-1 shrink-0 text-fg-secondary-alt"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          {url ? (
            name && (
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-fg-primary">
                  {name}
                </p>
                {detail && (
                  <p className="mt-0.5 truncate text-[0.6875rem] text-fg-secondary-alt">
                    {detail}
                  </p>
                )}
              </div>
            )
          ) : (
            <p className="text-xs text-fg-secondary">
              {uploading
                ? uploadingLabel
                : canDrop
                  ? "Drop an image here, or"
                  : "No image yet"}
            </p>
          )}
          {!(uploading && !url) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {url ? actions : emptyActions}
            </div>
          )}
        </div>
        {!url && progress}
      </div>
    );
  }

  if (!url) {
    return (
      <div
        {...dropHandlers}
        className={cn(
          "relative flex w-full max-w-xl flex-col items-center justify-center gap-3 overflow-hidden",
          // A fixed minimum, so the box does not jump when uploading hides
          // the buttons.
          "min-h-40 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
          dragOver
            ? "border-border-focus bg-bg-secondary"
            : "border-border-primary",
        )}
      >
        <ImagePlus
          size={22}
          strokeWidth={1.5}
          className="text-fg-secondary-alt"
        />
        <p className="text-xs text-fg-secondary">
          {uploading
            ? uploadingLabel
            : canDrop
              ? "Drop an image here, or"
              : "No image yet"}
        </p>
        {!uploading && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {emptyActions}
          </div>
        )}
        {progress}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <div
        {...dropHandlers}
        className={cn(
          "group relative aspect-video w-full overflow-hidden rounded-lg",
          "border border-border-primary bg-bg-secondary",
        )}
      >
        {picture}
        <div
          className={cn(
            "absolute right-2 top-2 flex flex-wrap justify-end gap-1.5 transition-opacity",
            "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            "[@media(hover:none)]:opacity-100",
            // Buttons on a photo: an opaque face and a shadow, or a white
            // label on a white sky is no label at all.
            //
            // `color-mix` rather than `bg-bg-primary/90`: the theme colours are
            // bare `var()`s, and Tailwind's opacity modifier emits nothing for
            // those, silently.
            "[&_button]:bg-[color-mix(in_srgb,var(--bg-primary)_88%,transparent)]",
            "[&_button]:shadow-sm [&_button]:backdrop-blur",
          )}
        >
          {actions}
        </div>
        {dropOverlay}
        {progress}
      </div>
      {name && (
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="truncate text-xs font-medium text-fg-primary">{name}</p>
          {detail && (
            <p className="shrink-0 truncate text-[0.6875rem] text-fg-secondary-alt">
              {detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A thin bar along the bottom edge, instead of a spinner over the picture.
 *
 * The spinner covered the one thing worth looking at while waiting, and said
 * nothing about how long. Until the first bytes have gone there is nothing to
 * measure — no number, or 0% — so the bar is indeterminate until there is.
 */
function UploadProgress({
  progressPercentage,
}: {
  progressPercentage: number | null;
}) {
  const indeterminate = !progressPercentage;
  return (
    <div
      role="progressbar"
      aria-label="Uploading"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progressPercentage ?? undefined}
      className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-bg-tertiary"
    >
      <div
        className={cn(
          "h-full bg-border-brand-primary transition-[width] duration-200",
          indeterminate && "w-1/3 animate-pulse",
        )}
        style={indeterminate ? undefined : { width: `${progressPercentage}%` }}
      />
    </div>
  );
}
