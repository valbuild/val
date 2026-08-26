import { ReactNode, useState } from "react";
import {
  ChevronRight,
  File as FileIcon,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { MediaThumbnail } from "../MediaThumbnail";

/**
 * What file this field is using, in one row.
 *
 * The thing an editor needs first is not the picture — it is *which* picture:
 * the name, the dimensions, the type. A field that renders the image full width
 * answers "roughly what does it look like" and nothing else, so the copy you
 * think the page is using and the copy it actually is are indistinguishable.
 * So: a thumbnail at a size that identifies rather than displays, the file's
 * particulars beside it, and the controls that change it on the same line.
 *
 * The thumbnail shows the focal point rather than cropping to it, and is never
 * enlarged past the file's own size — see `MediaThumbnail`. Cropping at this
 * size is not a preview of anything, and an 8x8 image stretched to fill the box
 * looks exactly like a large one that happens to be blurry.
 *
 * Shared by the image and file fields. A non-image has no thumbnail to show, so
 * it gets its type's icon; everything else about the row is the same, and two
 * versions of it would drift.
 */
export function MediaSummaryRow({
  url,
  name,
  detail,
  hotspot,
  actions,
  uploading,
  progressPercentage,
  isImage = true,
  onOpenPreview,
}: {
  /** Resolved URL of the file, or null when there is nothing chosen yet. */
  url: string | null;
  /** The file's name, e.g. `hero-mountains_a1b2c.jpg`. */
  name: string | null;
  /** Dimensions, type — whatever is known. Shown under the name. */
  detail: string | null;
  /** Focal point, so the thumbnail crops the way the page will. */
  hotspot?: { x: number; y: number };
  /** Change / browse / upload, whichever the field offers. */
  actions: ReactNode;
  uploading?: boolean;
  progressPercentage?: number | null;
  isImage?: boolean;
  /**
   * Open the file at a size worth looking at.
   *
   * The thumbnail is deliberately too small to judge an image by — it is there
   * to identify the file, not to show it — so there has to be a way to actually
   * see it, and the picture itself is where anyone would click.
   */
  onOpenPreview?: () => void;
}) {
  const Icon = isImage ? ImageIcon : FileIcon;
  const thumbnailClassName = cn(
    "relative grid h-[4.5rem] w-[7.5rem] shrink-0 place-items-center",
    "overflow-hidden rounded-md border border-border-primary bg-bg-secondary",
    onOpenPreview && "cursor-zoom-in hover:border-border-focus",
  );
  const thumbnail = (
    <>
      {isImage && url ? (
        // Never enlarged, and the focal point drawn rather than applied: see
        // `MediaThumbnail`. An 8x8 image blown up to fill this box is
        // indistinguishable from a large one that was merely cropped.
        <MediaThumbnail url={url} hotspot={hotspot} />
      ) : (
        <Icon size={20} strokeWidth={1.5} className="text-fg-secondary-alt" />
      )}
      {uploading && (
        <div className="absolute inset-0 grid place-items-center bg-bg-secondary/70">
          <Loader2 size={18} className="animate-spin text-fg-primary" />
          {progressPercentage !== null && progressPercentage !== undefined && (
            <span className="absolute bottom-1 text-[0.625rem] tabular-nums text-fg-primary">
              {progressPercentage}%
            </span>
          )}
        </div>
      )}
    </>
  );
  return (
    <div className="flex gap-3">
      {/* A real button when it does something, so it is reachable by keyboard
          and announced as an action rather than as decoration. */}
      {onOpenPreview ? (
        <button
          type="button"
          onClick={onOpenPreview}
          aria-label={isImage ? "View image" : "View file"}
          className={thumbnailClassName}
        >
          {thumbnail}
        </button>
      ) : (
        <div className={thumbnailClassName}>{thumbnail}</div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        {name ? (
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
        ) : (
          <p className="text-xs text-fg-secondary">
            {isImage ? "No image yet" : "No file yet"}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      </div>
    </div>
  );
}

/**
 * A labelled part of a media field.
 *
 * The hint is not decoration: "what the image shows, for people who cannot see
 * it" is the difference between an editor filling alt text in and skipping it.
 *
 * `collapsible` folds the section away behind its label. For the focal point
 * that is the right default: it is a crop hint most images never need, and open
 * by default it put a 500px-tall clickable picture between the file and
 * everything below it — so the field's own controls were off screen, and the
 * one thing an editor came for was the thing they had to scroll past. The
 * `summary` is what makes folding honest: a section you cannot see still has to
 * say whether it is set.
 */
export function Section({
  label,
  hint,
  summary,
  collapsible,
  children,
}: {
  label: string;
  hint?: string;
  /** Shown beside the label when folded, e.g. "50%, 50%" or "Not set". */
  summary?: string;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!collapsible) {
    return (
      <section>
        <h3 className="text-xs font-medium text-fg-primary">{label}</h3>
        {hint && (
          <p className="mb-2 mt-0.5 text-[0.6875rem] text-fg-secondary-alt">
            {hint}
          </p>
        )}
        {children}
      </section>
    );
  }
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <ChevronRight
          size={13}
          className={cn(
            "shrink-0 text-fg-secondary-alt transition-transform",
            open && "rotate-90",
          )}
        />
        <h3 className="text-xs font-medium text-fg-primary">{label}</h3>
        {summary && !open && (
          <span className="ml-auto truncate text-[0.6875rem] text-fg-secondary-alt">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2">
          {hint && (
            <p className="mb-2 text-[0.6875rem] text-fg-secondary-alt">
              {hint}
            </p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

/** `hero-mountains_a1b2c.jpg` -> `hero mountains` */
export function readableFilename(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  // The hash Val appends to every uploaded file is not part of what the image
  // is of, so a description built from the name should not carry it.
  return withoutExtension
    .replace(/_[0-9a-f]{5}$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}
