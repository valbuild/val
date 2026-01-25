import { SourcePath, ModuleFilePath } from "@valbuild/core";
import { RoutePattern } from "@valbuild/shared/internal";
import {
  SitemapItem,
  ExplorerItem,
  ExternalModule,
  NavMenuData,
} from "./types";

/**
 * Mock route pattern for /blogs/[blog]
 */
const blogsRoutePattern: RoutePattern[] = [
  { type: "literal", name: "blogs" },
  { type: "string-param", paramName: "blog", optional: false },
];

/**
 * Mock sitemap data for stories.
 */
export const mockSitemap: SitemapItem = {
  name: "/",
  urlPath: "/",
  children: [
    {
      name: "blogs",
      urlPath: "/blogs",
      canAddChild: true,
      moduleFilePath: "/app/blogs/[blog]/page.val.ts" as ModuleFilePath,
      routePattern: blogsRoutePattern,
      existingKeys: ["/blog-1", "/blog-2", "/blog-3"],
      children: [
        {
          name: "blog-1",
          urlPath: "/blogs/blog-1",
          sourcePath:
            '/app/blogs/[blog]/page.val.ts?p="/blogs/blog-1"' as SourcePath,
          children: [],
        },
        {
          name: "blog-2",
          urlPath: "/blogs/blog-2",
          sourcePath:
            '/app/blogs/[blog]/page.val.ts?p="/blogs/blog-2"' as SourcePath,
          children: [],
        },
        {
          name: "blog-3",
          urlPath: "/blogs/blog-3",
          sourcePath:
            '/app/blogs/[blog]/page.val.ts?p="/blogs/blog-3"' as SourcePath,
          children: [],
        },
      ],
    },
    {
      name: "about",
      urlPath: "/about",
      sourcePath: "/app/about/page.val.ts" as SourcePath,
      children: [],
    },
    {
      name: "products",
      urlPath: "/products",
      children: [
        {
          name: "widget",
          urlPath: "/products/widget",
          sourcePath: "/app/products/widget/page.val.ts" as SourcePath,
          children: [],
        },
        {
          name: "gadget",
          urlPath: "/products/gadget",
          sourcePath: "/app/products/gadget/page.val.ts" as SourcePath,
          children: [],
        },
      ],
    },
  ],
};

/**
 * Mock explorer data for stories.
 */
export const mockExplorer: ExplorerItem = {
  name: "/",
  fullPath: "/",
  isDirectory: true,
  children: [
    {
      name: "content",
      fullPath: "/content",
      isDirectory: true,
      children: [
        {
          name: "authors.val.ts",
          fullPath: "/content/authors.val.ts",
          isDirectory: false,
          children: [],
        },
        {
          name: "settings.val.ts",
          fullPath: "/content/settings.val.ts",
          isDirectory: false,
          children: [],
          hasError: true,
        },
      ],
    },
    {
      name: "schema",
      fullPath: "/schema",
      isDirectory: true,
      children: [
        {
          name: "image.val.ts",
          fullPath: "/schema/image.val.ts",
          isDirectory: false,
          children: [],
        },
      ],
    },
    {
      name: "components",
      fullPath: "/components",
      isDirectory: true,
      children: [
        {
          name: "link.val.ts",
          fullPath: "/components/link.val.ts",
          isDirectory: false,
          children: [],
        },
      ],
    },
  ],
};

/**
 * Mock external module data for stories.
 */
export const mockExternal: ExternalModule = {
  moduleFilePath: "/app/external.val.ts" as ModuleFilePath,
};

/**
 * Complete mock nav data for stories.
 */
export const mockNavMenuData: NavMenuData = {
  sitemap: mockSitemap,
  explorer: mockExplorer,
  external: mockExternal,
};

/**
 * Mock data with only sitemap (no explorer or external).
 */
export const mockNavMenuDataSitemapOnly: NavMenuData = {
  sitemap: mockSitemap,
};

/**
 * Mock data with only explorer (no sitemap or external).
 */
export const mockNavMenuDataExplorerOnly: NavMenuData = {
  explorer: mockExplorer,
};

/**
 * Large sitemap for testing scroll behavior.
 */
export const mockLargeSitemap: SitemapItem = {
  name: "/",
  urlPath: "/",
  children: [
    {
      name: "blogs",
      urlPath: "/blogs",
      canAddChild: true,
      moduleFilePath: "/app/blogs/[blog]/page.val.ts" as ModuleFilePath,
      routePattern: blogsRoutePattern,
      existingKeys: Array.from({ length: 30 }, (_, i) => `/blog-${i + 1}`),
      children: Array.from({ length: 30 }, (_, i) => ({
        name: `blog-${i + 1}`,
        urlPath: `/blogs/blog-${i + 1}`,
        sourcePath: `/app/blogs/[blog]/page.val.ts?p="/blogs/blog-${
          i + 1
        }"` as SourcePath,
        children: [],
      })),
    },
  ],
};

/**
 * Large explorer for testing scroll behavior.
 */
export const mockLargeExplorer: ExplorerItem = {
  name: "/",
  fullPath: "/",
  isDirectory: true,
  children: [
    {
      name: "content",
      fullPath: "/content",
      isDirectory: true,
      children: Array.from({ length: 20 }, (_, i) => ({
        name: `article-${i + 1}.val.ts`,
        fullPath: `/content/article-${i + 1}.val.ts`,
        isDirectory: false,
        children: [],
        hasError: i === 5, // One file has an error
      })),
    },
    {
      name: "schema",
      fullPath: "/schema",
      isDirectory: true,
      children: Array.from({ length: 15 }, (_, i) => ({
        name: `schema-${i + 1}.val.ts`,
        fullPath: `/schema/schema-${i + 1}.val.ts`,
        isDirectory: false,
        children: [],
      })),
    },
    {
      name: "components",
      fullPath: "/components",
      isDirectory: true,
      children: [
        {
          name: "ui",
          fullPath: "/components/ui",
          isDirectory: true,
          children: Array.from({ length: 10 }, (_, i) => ({
            name: `component-${i + 1}.val.ts`,
            fullPath: `/components/ui/component-${i + 1}.val.ts`,
            isDirectory: false,
            children: [],
          })),
        },
        {
          name: "layout",
          fullPath: "/components/layout",
          isDirectory: true,
          children: Array.from({ length: 5 }, (_, i) => ({
            name: `layout-${i + 1}.val.ts`,
            fullPath: `/components/layout/layout-${i + 1}.val.ts`,
            isDirectory: false,
            children: [],
          })),
        },
      ],
    },
  ],
};
