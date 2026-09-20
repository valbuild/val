import { Globe } from "lucide-react";
import { ReactNode } from "react";
import { Description } from "../utils/describePath";
import { useMediaUrl } from "../utils/mediaUrl";
import { cn } from "./designSystem/cn";
import { EditorDensity } from "./EditorDensity";

/**
 * How a page's URL is shown once its TITLE is no longer the URL.
 *
 * A page in a router record is keyed by its route, and until now that key was
 * the heading: the top of the editor column read `/blogs/launch`. A
 * `.preview(...)` that titles the page "Launching Val 1.0" is a better name and
 * a worse identifier — two drafts both called "Launch" are told apart by their
 * URLs and by nothing else — so the URL has to survive somewhere visible.
 *
 * `trail` is the one we picked: the URL joins the scope line that is already
 * under every heading, which costs no new chrome and leaves the subtitle free
 * for what the preview actually said. The rest are kept because the choice is
 * worth being able to re-open — see the `PagesUrlOptions` story, which renders
 * all four from one description.
 */
export type PageUrlStyle =
  /** The URL joins the scope trail under the heading. The default. */
  | "trail"
  /** Title is the page's name; the URL takes the subtitle line. */
  | "subtitle"
  /** Title is the page's name; the URL is a pill beside it. */
  | "chip"
  /** Title stays the URL; the page's name is the line under it. */
  | "title";

/**
 * One height, whatever the description turned out to hold.
 *
 * A heading whose height depends on what a developer happened to write is a
 * studio that jumps as you click through it: one module has a subtitle, the
 * next does not, and the editor column and everything under it move. So the
 * heading is always a title block plus a scope line — and nothing inside it can
 * change that: a missing subtitle is absorbed by centering, and the thumbnail
 * is sized to the block rather than the block to the thumbnail.
 *
 * `block` is title plus subtitle held whether or not there IS a subtitle, with
 * the content CENTERED in it rather than pinned to the top. Reserving the
 * subtitle line and leaving it empty also gives a constant height, and it looks
 * like a bug: a lone title with a blank line under it reads as something that
 * failed to load, not as air. Centering spends the same height as breathing
 * room above and below the title instead, which is what a heading with one line
 * wants anyway.
 *
 * The numbers are `leading-*` values, not paddings, so the lines sit on a
 * regular rhythm rather than being spaced by whatever the glyphs measured, and
 * `block` is exactly the two lines it holds: 32 + 20 full, 24 + 16 compact.
 *
 * Two sizes because the editor is not always alone on the screen — see
 * {@link EditorDensity}. The shape is identical in both: the same three lines,
 * the same square thumbnail, the same fixed height. Only the scale changes, so
 * a heading cannot be one thing beside the canvas and another without it.
 */
type HeadingSize = {
  /** The title line. */
  title: string;
  /** The subtitle, and the scope line under the block. */
  secondary: string;
  /** Title plus subtitle, which is also the thumbnail's height. */
  block: string;
  /** The thumbnail's width, which has to match `block` — it is a square. */
  image: string;
  /** Between the block and the scope line. */
  gap: string;
};

const SIZES: Record<EditorDensity, HeadingSize> = {
  full: {
    title: "h-8 text-2xl leading-8",
    secondary: "h-5 text-sm leading-5",
    block: "h-[52px]",
    image: "w-[52px]",
    gap: "gap-2",
  },
  compact: {
    title: "h-6 text-lg leading-6",
    secondary: "h-4 text-xs leading-4",
    block: "h-10",
    image: "w-10",
    gap: "gap-1",
  },
};

/**
 * The heading of whatever is being edited: what it is called, what it is, and
 * what it looks like.
 *
 * Presentational on purpose — it takes a {@link Description} and draws it, and
 * has no idea where the description came from. That is what lets the same
 * component draw a module root, a record entry and a page, and what lets a
 * story show all of them without a store.
 */
export function PathHeading({
  description,
  title: titleOverride,
  pageUrlStyle = "trail",
  density = "full",
  tools,
  below,
  scope,
  className,
}: {
  description: Description;
  /**
   * Drawn instead of `description.title`, for the two things the studio renders
   * richer than a string: a route as a segmented breadcrumb, and the page list
   * behind a globe. It replaces the title TEXT and nothing else — the line it
   * sits on, the subtitle and the scope are the same either way, so an override
   * cannot make one heading a different shape from the next.
   */
  title?: ReactNode;
  /** Ignored unless `description.url` is set. */
  pageUrlStyle?: PageUrlStyle;
  /**
   * How much room the heading may spend. See {@link EditorDensity}.
   *
   * A prop rather than the context, read here: this component is drawn by
   * stories and tests with no provider around it, and a heading whose size
   * depends on something invisible is one nobody can render deliberately.
   * `Module` is what reads the context.
   */
  density?: EditorDensity;
  /** The record tools, on the right of the title row. */
  tools?: ReactNode;
  /**
   * Anything that belongs to what is being EDITED rather than to the heading —
   * the field's own `.describe()`, a validation error on the key. Under the
   * fixed lines, so it cannot change the heading's height.
   */
  below?: ReactNode;
  /** The scope trail, on the line under the heading. */
  scope?: ReactNode;
  className?: string;
}) {
  const size = SIZES[density];
  const { title, subtitle, image, url } = description;
  // See the note in `ListPreviewItem`: a draft upload is served from its patch.
  const imageUrl = useMediaUrl(image);
  const isPage = url !== null;
  const titleText = isPage && pageUrlStyle === "title" ? url : title;
  /*
   * The second line, in priority order. `subtitle` and `title` spend it on the
   * half of the pair that is not in the heading; every other shape leaves it to
   * the subtitle, which is why `trail` is the default — it is the only one that
   * shows the URL without taking the subtitle away.
   */
  const secondLine: ReactNode =
    isPage && pageUrlStyle === "subtitle" ? (
      <PageUrl url={url} />
    ) : isPage && pageUrlStyle === "title" ? (
      <span className="truncate text-fg-tertiary">{title}</span>
    ) : subtitle ? (
      <span className="truncate text-fg-tertiary">{subtitle}</span>
    ) : null;
  /*
   * ...unless the title already IS the URL. With no preview to name the page,
   * `describePath` falls the title back to the route — and a heading that reads
   * `/blogs/launch` over a trail that reads `Blogs / /blogs/launch` says the
   * same thing twice. The trail line is reserved either way, so dropping it
   * costs no height.
   */
  const showUrlInTrail =
    isPage &&
    pageUrlStyle === "trail" &&
    description.origin.title === "preview";
  return (
    <div className={cn("flex flex-col text-left", size.gap, className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {image !== null && (
            /*
             * Square, and exactly as tall as the two lines beside it — so a
             * heading with an image and one without are the same height and
             * the thumbnail reads as part of the block rather than as
             * something that pushed it open.
             */
            <img
              src={imageUrl ?? undefined}
              alt=""
              className={cn(
                "shrink-0 rounded-md bg-bg-secondary object-cover",
                size.image,
                size.block,
              )}
              style={{
                objectPosition: image.hotspot
                  ? `${image.hotspot.x * 100}% ${image.hotspot.y * 100}%`
                  : "",
              }}
            />
          )}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col justify-center",
              size.block,
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              {/*
               * A heading in the role sense, as the module header already was:
               * not an `<h1>` element, because a page's URL is rendered as a
               * breadcrumb and a `<nav>` inside a heading is not valid HTML.
               */}
              <div
                role="heading"
                aria-level={1}
                className={cn("flex min-w-0 items-center truncate", size.title)}
              >
                {titleOverride ?? titleText}
              </div>
              {isPage && pageUrlStyle === "chip" && <PageUrlChip url={url} />}
            </div>
            {secondLine && (
              <div className={cn("flex min-w-0 items-center", size.secondary)}>
                {secondLine}
              </div>
            )}
          </div>
        </div>
        {tools && (
          <div className="flex shrink-0 items-center gap-2">{tools}</div>
        )}
      </div>
      {/* Likewise always present: the scope line, with the URL folded in. */}
      <div
        className={cn("flex min-w-0 items-center gap-1.5", size.secondary)}
        aria-hidden={!scope && !showUrlInTrail}
      >
        {scope}
        {showUrlInTrail && (
          <>
            {scope && <span className="shrink-0 text-fg-secondary-alt">/</span>}
            <PageUrl url={url} />
          </>
        )}
      </div>
      {below}
    </div>
  );
}

/**
 * A URL, segmented so the slashes recede and the segments read.
 *
 * Selectable text rather than a decorated string: the commonest thing an
 * editor does with a page's URL is copy it into a browser or a message.
 */
export function PageUrl({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const segments = url.split("/").filter(Boolean);
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 font-mono text-fg-tertiary",
        className,
      )}
      title={url}
    >
      <Globe size={13} aria-hidden className="shrink-0" />
      <span className="truncate">
        {segments.length === 0 ? (
          <span className="text-fg-secondary">/</span>
        ) : (
          segments.map((segment, i) => (
            <span key={i}>
              <span className="text-fg-secondary-alt">/</span>
              <span className="text-fg-secondary">{segment}</span>
            </span>
          ))
        )}
      </span>
    </span>
  );
}

/** The same URL as a pill, for when it sits beside the title rather than under it. */
function PageUrlChip({ url }: { url: string }) {
  return (
    <span className="shrink-0 rounded-full border border-border-primary bg-bg-secondary px-2 py-0.5">
      <PageUrl url={url} className="text-xs" />
    </span>
  );
}
