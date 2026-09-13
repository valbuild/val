import { Internal } from "@valbuild/core";
import { Globe } from "lucide-react";
import { ReactNode } from "react";
import { Description } from "../utils/describePath";
import { cn } from "./designSystem/cn";

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
 * heading is always {@link TITLE_BLOCK} plus a scope line — 52 + 8 + 20 — and
 * nothing inside it can change that: a missing subtitle is absorbed by
 * centering, and the thumbnail is sized to the block rather than the block to
 * the thumbnail.
 *
 * The numbers are `leading-*` values, not paddings, so the lines sit on a
 * regular rhythm rather than being spaced by whatever the glyphs measured:
 * 32px for the title, 20px for each of the two secondary lines.
 */
const TITLE_LINE = "h-8 text-2xl leading-8";
const SECONDARY_LINE = "h-5 text-sm leading-5";
/**
 * Title plus subtitle — 32 + 20 — held whether or not there is a subtitle, with
 * the content CENTERED in it rather than pinned to the top.
 *
 * Reserving the subtitle line and leaving it empty also gives a constant
 * height, and it looks like a bug: a lone title with a blank line under it
 * reads as something that failed to load, not as air. Centering spends the
 * same 52px as breathing room above and below the title instead, which is
 * what a heading with one line wants anyway. It is also what the thumbnail is
 * sized to, so an image cannot change the height either.
 */
const TITLE_BLOCK = "h-[52px]";

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
  pageUrlStyle = "trail",
  tools,
  scope,
  className,
}: {
  description: Description;
  /** Ignored unless `description.url` is set. */
  pageUrlStyle?: PageUrlStyle;
  /** The record tools, on the right of the title row. */
  tools?: ReactNode;
  /** The scope trail, on the line under the heading. */
  scope?: ReactNode;
  className?: string;
}) {
  const { title, subtitle, image, url } = description;
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
    <div className={cn("flex flex-col gap-2 text-left", className)}>
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
              src={Internal.mediaUrl(image)}
              alt=""
              className={cn(
                "w-[52px] shrink-0 rounded-md bg-bg-secondary object-cover",
                TITLE_BLOCK,
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
              TITLE_BLOCK,
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
                className={cn("min-w-0 truncate", TITLE_LINE)}
              >
                {titleText}
              </div>
              {isPage && pageUrlStyle === "chip" && <PageUrlChip url={url} />}
            </div>
            {secondLine && (
              <div className={cn("flex min-w-0 items-center", SECONDARY_LINE)}>
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
        className={cn("flex min-w-0 items-center gap-1.5", SECONDARY_LINE)}
        aria-hidden={!scope && !showUrlInTrail}
      >
        {scope}
        {showUrlInTrail && (
          <>
            {scope && <span className="shrink-0 text-fg-quaternary">/</span>}
            <PageUrl url={url} />
          </>
        )}
      </div>
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
              <span className="text-fg-quaternary">/</span>
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
