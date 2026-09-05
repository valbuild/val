import { SourcePath, ModuleFilePath } from "@valbuild/core";
import { RoutePattern } from "@valbuild/shared/internal";

/**
 * Validation error summary for a single nav menu row.
 *
 * `ownCount` is the number of errors that resolve directly to this row (a
 * file's own errors, or a sitemap entry's nested errors). Descendant counts
 * are computed at render time by recursing the tree.
 */
export type NavItemErrors = {
  /** Errors that resolve directly to this item (not descendants). */
  ownCount: number;
  /** First error's user-facing message — used in tooltips. */
  firstMessage?: string;
};

/**
 * Represents a page or folder in the site map tree.
 * Used for Next.js app router pages.
 */
export type SitemapItem = {
  /** Display name (e.g., "blog-1", "about") */
  name: string;
  /** URL path (e.g., "/blogs/blog-1") */
  urlPath: string;
  /** Val source path for navigation (if this item is navigable) */
  sourcePath?: SourcePath;
  /** Module file path (for route patterns that allow adding children) */
  moduleFilePath?: ModuleFilePath;
  /** Whether this item can have children added (has route params) */
  canAddChild?: boolean;
  /** Route pattern for add form (e.g., [{ type: "literal", name: "blogs" }, { type: "string-param", paramName: "blog" }]) */
  routePattern?: RoutePattern[];
  /** Existing children keys (for validation in add form) */
  existingKeys?: string[];
  /** Validation errors attributable to this row (not descendants). */
  errors?: NavItemErrors;
  /** Description of the router key schema (shown in the add page form) */
  keyDescription?: string;
  /** Child pages/folders */
  children: SitemapItem[];
  /** Whether this item or any descendant has validation errors */
  hasError?: boolean;
};

/**
 * Represents a val module file or folder in the explorer tree.
 * Used for non-router val files.
 */
export type ExplorerItem = {
  /** File or folder name */
  name: string;
  /** Full module file path */
  fullPath: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Child items */
  children: ExplorerItem[];
  /** Validation errors attributable to this file (not descendants). */
  errors?: NavItemErrors;
  /**
   * @deprecated Set `errors` instead. Retained so callers that constructed
   * mock data with just `hasError: true` keep working.
   */
  hasError?: boolean;
};

/**
 * A gallery module - `s.images()` or `s.files()` - shown under Media.
 *
 * These are records keyed by file path with a `mediaType` marker, so the useful
 * unit in the nav menu is the DIRECTORY they are constrained to rather than the
 * module file. Selecting one opens the module, which renders the gallery.
 */
export type MediaModule = {
  /** Module file path of the gallery module. */
  moduleFilePath: ModuleFilePath;
  /** The directory the gallery is constrained to, e.g. `/public/val/images`. */
  directory: string;
  /** Whether this gallery holds images or arbitrary files. */
  mediaType: "files" | "images";
  /**
   * Whether files can be uploaded into it.
   *
   * False for a `.readonly()` gallery, and for an `.external()` one — whose
   * files live behind an adapter that Val cannot write to yet. Browsing either
   * is fine; offering "Upload" on one is offering something that cannot work.
   */
  canUpload: boolean;
  /** Validation errors attributable to this module. */
  errors?: NavItemErrors;
};

/**
 * External URL module information.
 */
export type ExternalModule = {
  /** Module file path for the external URL module */
  moduleFilePath: ModuleFilePath;
  /** Whether this module has validation errors */
  hasError?: boolean;
};

/**
 * Combined navigation menu data.
 */
export type NavMenuData = {
  /**
   * Whether the project declares any `s.router` module at all.
   *
   * Not the same as `sitemap` being present: a router with no entries yet, or
   * one whose source folder has not resolved, has no tree to show but is still
   * a project that has pages. The distinction matters because the shell hides
   * the Pages destination entirely when a project has no routes — a site map
   * for a project that is only content files is an empty room — and hiding it
   * for a project that merely has not created its first page would be wrong.
   */
  hasRouters: boolean;
  /** Site map data (if next-app-router exists) */
  sitemap?: SitemapItem;
  /** Explorer data (if there are non-router val files) */
  explorer?: ExplorerItem;
  /** External module (if external-url-router exists) */
  external?: ExternalModule;
  /** `s.images()` / `s.files()` gallery modules, shown under Media. */
  media?: MediaModule[];
  /**
   * The project's `s.settings()` module, when it has exactly one valid one.
   *
   * Absent both when the project has no settings module and when what it has
   * cannot be used — two of them, or one in a subdirectory. Those are reported
   * as module errors (see `resolveSettingsModule`); the navigation's job is
   * only to say whether there is a Settings destination to go to.
   */
  settings?: SettingsModule;
};

export type SettingsModule = {
  moduleFilePath: ModuleFilePath;
};

/**
 * Section identifiers for the accordion.
 */
export type NavSection = "sitemap" | "explorer";
