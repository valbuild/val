import { ReactNode } from "react";
import { File as FileIcon, Image as ImageIcon, Loader2 } from "lucide-react";
import { cn } from "../designSystem/cn";

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
 * The thumbnail respects the hotspot, because a thumbnail is itself a crop —
 * showing the focal point being ignored right above the control that sets it
 * would be its own small lie.
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
}) {
  const Icon = isImage ? ImageIcon : FileIcon;
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "relative grid h-[4.5rem] w-[7.5rem] shrink-0 place-items-center",
          "overflow-hidden rounded-md border border-border-primary bg-bg-secondary",
        )}
      >
        {isImage && url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            style={{
              objectPosition: hotspot
                ? `${hotspot.x * 100}% ${hotspot.y * 100}%`
                : undefined,
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon size={20} strokeWidth={1.5} className="text-fg-secondary-alt" />
        )}
        {uploading && (
          <div className="absolute inset-0 grid place-items-center bg-bg-secondary/70">
            <Loader2 size={18} className="animate-spin text-fg-primary" />
            {progressPercentage !== null &&
              progressPercentage !== undefined && (
                <span className="absolute bottom-1 text-[0.625rem] tabular-nums text-fg-primary">
                  {progressPercentage}%
                </span>
              )}
          </div>
        )}
      </div>
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
 */
export function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
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
