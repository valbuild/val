import {
  ImageSource,
  Internal,
  isPageRouter,
  ModuleFilePath,
  PreviewItem,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { prettifyFilename } from "./prettifyFilename";

/**
 * WHERE a line of a {@link Description} came from.
 *
 * Carried out of the utility rather than thrown away, because the two are not
 * interchangeable to a reader: a `preview` title is a sentence a developer
 * wrote for an editor, and a `fallback` title is a key, an index or a file name
 * that happens to be the only name we have. A surface that renders them
 * identically tells an editor that `hero_2` is what someone decided to call
 * this, which is the misreading this whole utility exists to stop. Surfaces are
 * free to ignore it; none of them may be unable to tell.
 */
export type DescriptionOrigin = "preview" | "fallback";

/**
 * What a path is CALLED, wherever a path has to be shown to a human.
 *
 * One shape, one set of fallback rules, one place they are written down. The
 * studio shows a source path under a name in at least six places — the module
 * heading, list rows, the scope trail, search hits, reference dropdowns, the
 * references list, the sitemap — and before this each of them derived that name
 * itself. They did not agree: the same record entry was `blog1` in one place,
 * "Blog 1" in another and `/blogs/blog1` in a third.
 *
 * This is a PREVIEW concern and only that. A schema's `.describe()` is input
 * help — it belongs where the field, or a record's key, is being ENTERED, and
 * a path being labelled is a path the reader cannot change anything on. It is
 * never a subtitle here: folding it in would repeat one sentence under every
 * row of a list, and would say it before the value it is supposed to describe
 * even exists. See the rule at the top of `core/src/preview.ts`.
 *
 * `title` is never empty. Every other line is nullable, and `null` means "there
 * is nothing to show here", NOT "show the path instead" — a surface that wants
 * a second line when there is no subtitle should decide that itself, since only
 * it knows whether it has the room.
 */
export type Description = {
  /** Never empty: falls all the way back to the last path segment. */
  title: string;
  subtitle: string | null;
  /**
   * `null` means no image — the surface may drop the thumbnail column
   * entirely. A preview that declares an image the value does not have comes
   * back as `null` too; {@link ListPreviewItem}'s three-state `image` prop is
   * the one place that distinction is drawn, and it draws it from the raw
   * {@link PreviewItem}, not from here.
   */
  image: ImageSource | null;
  /** The module this path is in. Always present; every path has one. */
  moduleFilePath: ModuleFilePath;
  /**
   * Is this path the module ITSELF, rather than something inside it?
   *
   * Carried because a surface that renames a module has to decide whether to
   * keep the file path visible, and that question only arises here — see
   * `PathHeading`.
   */
  isModuleRoot: boolean;
  /**
   * What the PATH alone says this is called — the route, the key, `#3`, the
   * prettified file name — whether or not a preview overrode it.
   *
   * `title` is this when nothing better exists, and a surface that shows both
   * needs them separately: a search hit leads with the name and keeps the key
   * above it as provenance, because two hits in one module are told apart by
   * their paths and by nothing else.
   */
  pathLabel: string;
  /**
   * The URL this path is a page of, when it is one — the key of a router
   * record, verbatim.
   *
   * Separate from `title` and `subtitle` on purpose. A page's URL is not a
   * nicer name for the page, it is the page's IDENTITY: two drafts called
   * "Launch" are told apart by `/blog/launch-2026` and nothing else, and a
   * preview title that replaces it takes that away. So the URL is always
   * carried, whether or not a preview named the page, and a surface that shows
   * pages is expected to render it — see `PageUrl`.
   */
  url: string | null;
  origin: {
    title: DescriptionOrigin;
    subtitle: DescriptionOrigin;
    image: DescriptionOrigin;
  };
};

export type DescribeInput = {
  path: SourcePath | ModuleFilePath;
  /**
   * What this value's own schema's `.preview(...)` produced for it, if
   * anything. `undefined`/`null` — no preview declared, not computed yet, or
   * the closure threw — all mean the same thing here: fall back.
   */
  preview?: PreviewItem | null;
  /** This value's own schema. Decides the module-root and media fallbacks. */
  schema?: SerializedSchema;
  /**
   * The schema of the container this value sits in, or `undefined` at a module
   * root. This is what says whether the last path segment is an array index, a
   * record key or a route — three things that must not be shown the same way.
   */
  parentSchema?: SerializedSchema;
};

/**
 * The one implementation of "what do we call this path".
 *
 * Pure, so it is testable without a store and reusable from anywhere that has
 * a path, a schema and (maybe) a preview — the hook {@link useDescription} is a
 * thin wrapper that fetches those three things.
 */
export function describePath({
  path,
  preview,
  schema,
  parentSchema,
}: DescribeInput): Description {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path as SourcePath);
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  const lastSegment = segments[segments.length - 1];
  const isModuleRoot = segments.length === 0;

  const previewTitle = preview?.title?.trim();
  const previewSubtitle = preview?.subtitle?.trim();

  // A page's URL is its identity, not a name for it: carried whether or not a
  // preview also named the page. See `Description.url`.
  const url =
    lastSegment !== undefined &&
    parentSchema?.type === "record" &&
    typeof parentSchema.router === "string" &&
    isPageRouter(parentSchema.router)
      ? lastSegment
      : null;

  const pathLabel = fallbackTitle();

  return {
    title: previewTitle || pathLabel,
    moduleFilePath,
    isModuleRoot,
    pathLabel,
    subtitle: previewSubtitle || null,
    image: preview?.image ?? null,
    url,
    origin: {
      title: previewTitle ? "preview" : "fallback",
      subtitle: previewSubtitle ? "preview" : "fallback",
      image: preview?.image ? "preview" : "fallback",
    },
  };

  function fallbackTitle(): string {
    if (
      schema?.type === "record" &&
      typeof schema.router === "string" &&
      isPageRouter(schema.router)
    ) {
      // The router record ITSELF, not one of its pages: it is the site's page
      // list, and "Pages" is what the nav calls it. Kept here so the heading
      // and the nav cannot drift — `Module.tsx` had this rule of its own.
      return "Pages";
    }
    if (isModuleRoot) {
      // The file is the only name a module has. `/components/footer.val.ts`
      // reads as "Footer" — which is why a module-level `.preview()` is worth
      // having at all: nothing else here knows the module holds link groups.
      return (
        prettifyFilename(
          Internal.splitModuleFilePath(moduleFilePath).pop() || "",
        ) || moduleFilePath
      );
    }
    if (lastSegment === undefined) {
      return moduleFilePath;
    }
    if (url !== null) {
      // The route, verbatim. Prettifying a URL would produce a name that is
      // not the URL and not a title either.
      return url;
    }
    if (parentSchema?.type === "array") {
      // `#0`, not `0`: a bare index beside a title is read as part of it.
      return `#${lastSegment}`;
    }
    if (parentSchema?.type === "record") {
      // The key, verbatim and un-prettified: a record key is authored data,
      // and `fixCapitalization` on it invents a name the editor cannot search
      // for. A schema that wants "Blog 1" says so with `.preview(...)`.
      return lastSegment;
    }
    // An object property, or a path whose parent schema has not loaded yet.
    return prettifyFilename(lastSegment);
  }
}

/**
 * Is there anything here a developer did not have to write?
 *
 * For surfaces that want to nudge — an empty-state hint, a docs link on a
 * module whose every row is called `#3`. Deliberately not a warning: falling
 * back is legitimate, and for `s.record(s.string())` it is the right answer.
 */
export function isFullyFallback(description: Description): boolean {
  return (
    description.origin.title === "fallback" && description.subtitle === null
  );
}
