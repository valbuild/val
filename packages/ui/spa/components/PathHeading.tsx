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
 * URLs and by nothing else — so the URL has to survive somewhere visible. These
 * are the four places it can go. Pick one; they are not meant to be mixed
 * within a studio.
 */
export type PageUrlStyle =
  /** Title is the page's name; the URL is the line under it. */
  | "subtitle"
  /** Title stays the URL; the page's name is the line under it. */
  | "title"
  /** Title is the page's name; the URL is a pill beside it. */
  | "chip"
  /** Title is the page's name; the URL joins the scope trail below. */
  | "trail";

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
  pageUrlStyle = "subtitle",
  tools,
  scope,
  className,
}: {
  description: Description;
  /** Ignored unless `description.url` is set. */
  pageUrlStyle?: PageUrlStyle;
  /** The record tools, on the right of the title row. */
  tools?: ReactNode;
  /** The scope trail, under the heading. */
  scope?: ReactNode;
  className?: string;
}) {
  const { title, subtitle, image, url } = description;
  const isPage = url !== null;
  const titleText = isPage && pageUrlStyle === "title" ? url : title;
  // The second line, in priority order. A page under `subtitle` spends it on
  // the URL: the URL is identity and the subtitle is colour, and there is one
  // line.
  const secondLine: ReactNode =
    isPage && pageUrlStyle === "subtitle" ? (
      <PageUrl url={url} />
    ) : isPage && pageUrlStyle === "title" ? (
      <span className="text-sm text-fg-tertiary">{title}</span>
    ) : subtitle ? (
      <span className="text-sm text-fg-tertiary">{subtitle}</span>
    ) : null;

  return (
    <div className={cn("flex flex-col gap-2 text-left", className)}>
      <div className="flex gap-4 justify-between items-start min-h-6">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {image !== null && (
            /*
             * The heading's thumbnail. Square and title-height, so a heading
             * with an image and one without sit at the same baseline and a
             * list of modules does not jump as you click through it.
             */
            <img
              src={Internal.mediaUrl(image)}
              alt=""
              className="mt-0.5 h-10 w-10 shrink-0 rounded object-cover bg-bg-secondary"
              style={{
                objectPosition: image.hotspot
                  ? `${image.hotspot.x * 100}% ${image.hotspot.y * 100}%`
                  : "",
              }}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {/*
               * A heading in the role sense, as the module header already was:
               * not an `<h1>` element, because a page's URL is rendered as a
               * breadcrumb and a `<nav>` inside a heading is not valid HTML.
               */}
              <div
                role="heading"
                aria-level={1}
                className="min-w-0 text-2xl leading-tight truncate"
              >
                {titleText}
              </div>
              {isPage && pageUrlStyle === "chip" && <PageUrlChip url={url} />}
            </div>
            {secondLine && <div className="mt-1">{secondLine}</div>}
          </div>
        </div>
        {tools && (
          <div className="shrink-0 flex gap-2 items-center">{tools}</div>
        )}
      </div>
      {(scope || (isPage && pageUrlStyle === "trail")) && (
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {scope}
          {isPage && pageUrlStyle === "trail" && (
            <>
              {scope && <span className="text-fg-quaternary">/</span>}
              <PageUrl url={url} />
            </>
          )}
        </div>
      )}
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
        "inline-flex min-w-0 items-center gap-1 font-mono text-sm text-fg-tertiary",
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
