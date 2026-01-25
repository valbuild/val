import { SourcePath, ModuleFilePath } from "@valbuild/core";
import { RoutePattern } from "@valbuild/shared/internal";

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
  /** Child pages/folders */
  children: SitemapItem[];
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
  /** Whether this item or any descendant has validation errors */
  hasError?: boolean;
};

/**
 * External URL module information.
 */
export type ExternalModule = {
  /** Module file path for the external URL module */
  moduleFilePath: ModuleFilePath;
};

/**
 * Combined navigation menu data.
 */
export type NavMenuData = {
  /** Site map data (if next-app-router exists) */
  sitemap?: SitemapItem;
  /** Explorer data (if there are non-router val files) */
  explorer?: ExplorerItem;
  /** External module (if external-url-router exists) */
  external?: ExternalModule;
};

/**
 * Section identifiers for the accordion.
 */
export type NavSection = "sitemap" | "explorer";
