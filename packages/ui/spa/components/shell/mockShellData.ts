import { ModuleFilePath } from "@valbuild/core";
import {
  ShellActivityEntry,
  ShellData,
  ShellDataModule,
  ShellDeployment,
  ShellExternalPage,
  ShellMediaFile,
  ShellMediaGallery,
  ShellNewPageRoutes,
  ShellNotification,
  ShellPage,
  ShellValidationError,
} from "./types";
import { placeholderAvatar } from "../stories/placeholderAssets";

/**
 * Mock data for the shell stories.
 *
 * Shaped by `shellDataMapping`, not by hand: every field here is what that
 * mapping would actually produce from `useNavMenuData` and the patch sets, so
 * a story cannot pass on data the app can never supply. In particular
 *
 *  - a row's `id` is the content it opens, because that is what the mapping
 *    sets — a source path for a page, a module file path for everything else;
 *  - a page's `sourcePath` is `<route module>?p="<url>"`, the shape
 *    `getSitemapTree` builds, and a folder row that is only a path segment has
 *    none, so it expands rather than opens;
 *  - names are the raw segment for pages and the extension-stripped file name
 *    for data modules, matching what the nav menu shows today;
 *  - external pages are labelled by host, because the external router's keys
 *    are URLs and there is no other label to use.
 *
 * Sized to be realistic rather than pretty: real projects have dozens of pages
 * and a long tail of external links, and the panels have to stay usable at
 * that size.
 */

/** `/blog/why-we-built-val` -> the source path its route module resolves to. */
function pageSourcePath(routeModule: string, urlPath: string): string {
  return `${routeModule}?p=${JSON.stringify(urlPath)}`;
}

/**
 * A leaf page under a dynamic route.
 *
 * Every post under `/blog/[slug]` is served by the same route module and
 * differs only by the key, which is exactly why the id has to be the source
 * path: the route *pattern* is shared by all of them.
 */
function leafPage(
  routeModule: string,
  urlPath: string,
  extra: Partial<ShellPage> = {},
): ShellPage {
  const sourcePath = pageSourcePath(routeModule, urlPath);
  return {
    id: sourcePath,
    name: urlPath.split("/").filter(Boolean).slice(-1)[0] ?? "/",
    urlPath,
    sourcePath,
    isTracked: true,
    ...extra,
  };
}

const BLOG_ROUTE = "/app/blog/[slug]/page.val.ts";
const CUSTOMER_ROUTE = "/app/customers/[customer]/page.val.ts";
const DOCS_ROUTE = "/app/docs/[[...path]]/page.val.ts";

const blogPosts: ShellPage[] = [
  "why-we-built-val",
  "git-based-content-explained",
  "type-safe-content-for-nextjs",
  "shipping-a-cms-without-a-database",
  "content-modelling-for-developers",
  "structured-content-in-typescript",
  "migrating-from-a-headless-cms",
  "validation-as-a-content-feature",
  "draft-previews-without-a-preview-server",
  "editing-in-place",
  "the-case-against-page-builders",
  "localisation-without-lock-in",
].map((slug, i) =>
  leafPage(BLOG_ROUTE, `/blog/${slug}`, {
    hasDraft: i === 0 || i === 4,
    errorCount: i === 7 ? 1 : undefined,
  }),
);

const caseStudies: ShellPage[] = [
  "nordic-retail",
  "bergen-energy",
  "fjord-logistics",
  "aurora-bank",
  "vestland-municipality",
  "polar-media",
].map((slug, i) =>
  leafPage(CUSTOMER_ROUTE, `/customers/${slug}`, { hasDraft: i === 2 }),
);

const docsPages: ShellPage[] = [
  "getting-started",
  "installation",
  "schemas",
  "modules",
  "rich-text",
  "images-and-files",
  "remote-files",
  "validation",
  "patches",
  "cli",
  "deployment",
  "api-reference",
].map((slug, i) =>
  leafPage(DOCS_ROUTE, `/docs/${slug}`, {
    errorCount: i === 6 ? 2 : undefined,
  }),
);

/**
 * A folder row: a segment that exists only because pages exist below it.
 *
 * `getSitemapTree` gives these no source path, which is what makes them
 * unopenable. `urlPath` is the route pattern, because that is all a folder row
 * has — there is no single URL it resolves to.
 */
function folderPage(
  urlPath: string,
  name: string,
  children: ShellPage[],
): ShellPage {
  return { id: urlPath, name, urlPath, isTracked: false, children };
}

/** A page with its own route module, e.g. `/app/pricing/page.val.ts`. */
function staticPage(
  urlPath: string,
  extra: Partial<ShellPage> = {},
): ShellPage {
  const segments = urlPath.split("/").filter(Boolean);
  const routeModule =
    segments.length === 0
      ? "/app/page.val.ts"
      : `/app/${segments.join("/")}/page.val.ts`;
  return leafPage(routeModule, urlPath, extra);
}

export const mockPages: ShellPage[] = [
  { ...staticPage("/", { hasDraft: true }), name: "/" },
  staticPage("/about"),
  staticPage("/product"),
  staticPage("/pricing", { hasDraft: true }),
  folderPage("/features/[feature]", "features", [
    leafPage("/app/features/[feature]/page.val.ts", "/features/editor"),
    leafPage("/app/features/[feature]/page.val.ts", "/features/ai"),
    leafPage("/app/features/[feature]/page.val.ts", "/features/validation", {
      errorCount: 1,
    }),
    leafPage("/app/features/[feature]/page.val.ts", "/features/git"),
  ]),
  folderPage("/blog/[slug]", "blog", blogPosts),
  folderPage("/customers/[customer]", "customers", caseStudies),
  folderPage("/docs/[[...path]]", "docs", docsPages),
  staticPage("/changelog"),
  staticPage("/careers"),
  staticPage("/contact"),
  folderPage("/legal/[document]", "legal", [
    leafPage("/app/legal/[document]/page.val.ts", "/legal/privacy"),
    leafPage("/app/legal/[document]/page.val.ts", "/legal/terms"),
    leafPage("/app/legal/[document]/page.val.ts", "/legal/cookies"),
  ]),
];

const EXTERNAL_ROUTE = "/app/external.val.ts";

/**
 * External pages, as the external router produces them: the record's keys are
 * the URLs, so the id is the source path and the label is the host.
 */
function externalPage(
  url: string,
  extra: Partial<ShellExternalPage> = {},
): ShellExternalPage {
  const sourcePath = pageSourcePath(EXTERNAL_ROUTE, url);
  const parsed = new URL(url);
  return {
    id: sourcePath,
    name: `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`,
    url,
    sourcePath,
    ...extra,
  };
}

export const mockExternalPages: ShellExternalPage[] = [
  externalPage("https://instagram.com/valbuild"),
  externalPage("https://linkedin.com/company/val"),
  externalPage("https://x.com/valbuild"),
  externalPage("https://github.com/valbuild/val"),
  externalPage("https://youtube.com/@valbuild"),
  externalPage("https://portal.example.com"),
  externalPage("https://status.example.com"),
  externalPage("https://support.example.com"),
  externalPage("https://shop.example.com"),
  externalPage("https://jobs.example.com/val", { errorCount: 1 }),
  externalPage("https://discord.gg/val"),
  externalPage("https://val.substack.com"),
];

/**
 * The files in a gallery.
 *
 * Built rather than written out, because the panel's whole job is to stay
 * usable at a size nobody would type: the images gallery here has more files
 * than fit in one chunk, so the story shows the chunking doing something. The
 * refs carry the hash suffix `Internal.createFilename` adds, and some sit in
 * subdirectories, because both are true of a real gallery and both are what the
 * panel groups by.
 */
function galleryFiles(
  moduleFilePath: string,
  directory: string,
  names: string[],
): ShellMediaFile[] {
  return names.map((name) => {
    const ref = `${directory}/${name}`;
    return { ref, sourcePath: `${moduleFilePath}?p=${JSON.stringify(ref)}` };
  });
}

const IMAGE_NAMES: string[] = [
  "logo_a1b2c.png",
  "logo-dark_c3d4e.png",
  "hero-autumn_5f6a7.jpg",
  "hero-winter_8b9c0.jpg",
  "og-default_d1e2f.png",
  ...Array.from(
    { length: 48 },
    (_, i) =>
      `product-${String(i + 1).padStart(3, "0")}_${(i * 7919).toString(16).slice(0, 5)}.jpg`,
  ),
  "portraits/ada_1a2b3.jpg",
  "portraits/ida_4c5d6.jpg",
  "portraits/fredrik_7e8f9.jpg",
  "icons/check_0a1b2.svg",
  "icons/close_3c4d5.svg",
];

/**
 * Galleries, keyed by their module. The label is the last segment of the
 * directory the gallery is constrained to, which is what `directoryName`
 * produces — so it is lowercase, like the directory itself.
 */
export const mockMedia: ShellMediaGallery[] = [
  {
    id: "/content/media.val.ts",
    name: "images",
    directory: "/public/val/images",
    moduleFilePath: "/content/media.val.ts",
    itemCount: IMAGE_NAMES.length,
    mediaType: "images",
    canUpload: true,
    files: galleryFiles(
      "/content/media.val.ts",
      "/public/val/images",
      IMAGE_NAMES,
    ),
  },
  {
    id: "/content/illustrations.val.ts",
    name: "illustrations",
    directory: "/public/val/illustrations",
    moduleFilePath: "/content/illustrations.val.ts",
    itemCount: 3,
    mediaType: "images",
    canUpload: true,
    files: galleryFiles(
      "/content/illustrations.val.ts",
      "/public/val/illustrations",
      ["empty-state_a1b2c.svg", "onboarding_d3e4f.svg", "error_5a6b7.svg"],
    ),
  },
  {
    id: "/content/people.val.ts",
    name: "people",
    directory: "/public/val/people",
    moduleFilePath: "/content/people.val.ts",
    itemCount: 0,
    mediaType: "images",
    canUpload: true,
    // An empty gallery is a state of its own, and reads differently from one
    // that has not loaded.
    files: [],
  },
  {
    id: "/content/documents.val.ts",
    name: "docs",
    directory: "/public/val/docs",
    moduleFilePath: "/content/documents.val.ts",
    itemCount: 4,
    mediaType: "files",
    canUpload: true,
    files: galleryFiles("/content/documents.val.ts", "/public/val/docs", [
      "price-list_1a2b3.pdf",
      "terms_4c5d6.pdf",
      "legal/dpa_7e8f9.pdf",
      "legal/sla_0a1b2.pdf",
    ]),
  },
];

/** A val file under Data. The label is the file name without its extension. */
function dataModule(
  moduleFilePath: string,
  extra: Partial<ShellDataModule> = {},
): ShellDataModule {
  const file = moduleFilePath.split("/").pop() ?? moduleFilePath;
  return {
    id: moduleFilePath,
    name: file.replace(/\.val\.(ts|js)$/, ""),
    moduleFilePath,
    ...extra,
  };
}

/**
 * The Data panel is a tree, so the mock is a tree: modules at the top of a
 * directory, modules nested a couple of levels down, and more than one
 * top-level directory. A project that keeps everything in one flat `/content`
 * would never show the panel doing its job — and it is exactly the projects
 * that do organise their content that the tree exists for.
 */
export const mockDataModules: ShellDataModule[] = [
  dataModule("/content/navigation.val.ts", { hasDraft: true }),
  dataModule("/content/footer.val.ts"),
  dataModule("/content/shop/products.val.ts", { errorCount: 3 }),
  dataModule("/content/shop/categories.val.ts"),
  dataModule("/content/shop/shipping/zones.val.ts"),
  dataModule("/content/shop/shipping/rates.val.ts", { hasDraft: true }),
  dataModule("/content/editorial/authors.val.ts"),
  dataModule("/content/editorial/tags.val.ts"),
  dataModule("/content/i18n/en.val.ts"),
  dataModule("/content/i18n/nb.val.ts", { errorCount: 1 }),
  dataModule("/components/link.val.ts"),
  dataModule("/components/callToAction.val.ts"),
  dataModule("/schema/image.val.ts"),
];

/**
 * Val has no notification feed, so this is design surface rather than a
 * mapping of anything. Kept as prose a feed would plausibly produce.
 */
export const mockNotifications: ShellNotification[] = [
  {
    id: "n1",
    kind: "content",
    title: "/ was updated",
    timestamp: "2 minutes ago",
    unread: true,
  },
  {
    id: "n2",
    kind: "media",
    title: "hero-dark.png uploaded to /public/val/images",
    timestamp: "10 minutes ago",
    unread: true,
  },
  {
    id: "n3",
    kind: "validation",
    title: "3 validation errors in products",
    timestamp: "24 minutes ago",
    unread: true,
  },
  {
    id: "n4",
    kind: "content",
    title: "navigation was updated",
    timestamp: "1 hour ago",
  },
  {
    id: "n5",
    kind: "publish",
    title: "Published 12 changes to main",
    timestamp: "3 hours ago",
  },
  {
    id: "n6",
    kind: "content",
    title: "/pricing was created",
    timestamp: "Yesterday",
  },
];

/**
 * Validation errors, grouped the way `toValidationErrors` groups them: by
 * module file. There is no per-page grouping, because an error's source path
 * names the module it is in — a page under `/blog/[slug]` reports against its
 * route module, not against its URL.
 */
export const mockValidationErrors: ShellValidationError[] = [
  {
    id: "/content/shop/products.val.ts",
    title: "products",
    detail: "/content/shop/products.val.ts",
    count: 3,
  },
  {
    id: DOCS_ROUTE,
    title: "page",
    detail: DOCS_ROUTE,
    count: 2,
  },
  {
    id: "/app/features/[feature]/page.val.ts",
    title: "page",
    detail: "/app/features/[feature]/page.val.ts",
    count: 1,
  },
  {
    id: EXTERNAL_ROUTE,
    title: "external",
    detail: EXTERNAL_ROUTE,
    count: 1,
  },
];

/**
 * Recent activity, as `toActivity` builds it: the module's file label followed
 * by the patch path, and the author id resolved to a name where a profile is
 * known. A local dev project has no profiles, which is why the last entry has
 * no author rather than a placeholder one.
 */
export const mockActivity: ShellActivityEntry[] = [
  {
    id: '/app/page.val.ts?p="/"/hero/title-0',
    sourcePath: '/app/page.val.ts?p="/"."hero"."title"',
    title: "page › hero › title",
    timestamp: "2 minutes ago",
    author: "Fredrik Ekholdt",
  },
  {
    id: '/app/pricing/page.val.ts?p="/pricing"/plans-1',
    sourcePath: '/app/pricing/page.val.ts?p="/pricing"."plans"',
    title: "page › plans",
    timestamp: "18 minutes ago",
    author: "Fredrik Ekholdt",
  },
  {
    id: "/content/navigation.val.ts?primary-2",
    sourcePath: '/content/navigation.val.ts?p="primary"',
    title: "navigation › primary",
    timestamp: "1 hour ago",
    author: "Ida Sørensen",
  },
  {
    id: '/app/blog/[slug]/page.val.ts?p="/blog/why-we-built-val"/text-3',
    sourcePath:
      '/app/blog/[slug]/page.val.ts?p="/blog/why-we-built-val"."text"',
    title: "page › /blog/why-we-built-val › text",
    timestamp: "Yesterday",
  },
];

/** Full 40-character shas, as git produces and as the deployment feed joins on. */
/**
 * A fixed instant the mock timestamps are relative to, so `updatedAt` and the
 * already-formatted `timestamp` beside it agree with each other.
 */
const MOCK_NOW = new Date("2026-08-25T12:00:00Z").getTime();
const mockMinutesAgo = (minutes: number): string =>
  new Date(MOCK_NOW - minutes * 60 * 1000).toISOString();

export const mockDeployments: ShellDeployment[] = [
  {
    commitSha: "9f21c4ae0b7d1e5a3c8f2d6b04e7a915cd83f620",
    state: "pending",
    message: "Update hero copy and pricing table",
    author: "Fredrik Ekholdt",
    timestamp: "just now",
    updatedAt: mockMinutesAgo(0),
    isLive: false,
  },
  {
    commitSha: "3ab77c1902ef4d885b16c0da79f3e421ab5c9d08",
    state: "success",
    message: "Add customer story: nordic-retail",
    author: "Ida Sørensen",
    timestamp: "12 minutes ago",
    updatedAt: mockMinutesAgo(12),
    isLive: true,
  },
  {
    commitSha: "c05e9182aab34f6072d1e5b8c4a09f37e6215dba",
    state: "failure",
    message: "Swap footer links",
    author: "Fredrik Ekholdt",
    timestamp: "1 hour ago",
    updatedAt: mockMinutesAgo(60),
    isLive: false,
  },
];

/**
 * Two routes that accept a page, which is the case worth looking at.
 *
 * One dynamic segment and one with two, so the form's route picker has something
 * to pick between and its inputs have something to lay out. `existingKeys`
 * carries the URLs already in `mockPages`, so the "already exists" state is
 * reachable by typing `why-we-built-val` into the blog route.
 */
const mockNewPageRoutes: ShellNewPageRoutes = {
  routes: [
    {
      moduleFilePath: "/app/blogs/[blog]/page.val.ts" as ModuleFilePath,
      routePattern: [
        { type: "literal", name: "blogs" },
        { type: "string-param", paramName: "blog", optional: false },
      ],
      patternString: "/blogs/[blog]",
      existingKeys: blogPosts.map((post) => post.urlPath),
      keyDescription: "URL slug: lowercase, words separated by hyphens.",
    },
    {
      moduleFilePath:
        "/app/shop/[category]/[product]/page.val.ts" as ModuleFilePath,
      routePattern: [
        { type: "literal", name: "shop" },
        { type: "string-param", paramName: "category", optional: false },
        { type: "string-param", paramName: "product", optional: false },
      ],
      patternString: "/shop/[category]/[product]",
      existingKeys: [],
    },
  ],
};

export const mockShellData: ShellData = {
  projectName: "val-demo/val-demo-project",
  admin: {
    project: "https://admin.val.build/~/val-demo/val-demo-project",
    members: "https://admin.val.build/manage-members/val-demo",
  },
  branch: "main",
  hasRouters: true,
  pages: mockPages,
  newPage: mockNewPageRoutes,
  externalPages: mockExternalPages,
  media: mockMedia,
  settings: { moduleFilePath: "/settings.val.ts" as ModuleFilePath },
  data: mockDataModules,
  notifications: mockNotifications,
  activity: mockActivity,
  validationErrors: mockValidationErrors,
  deployments: mockDeployments,
  user: {
    name: "Fredrik Ekholdt",
    email: "fredrik@valbuild.com",
    avatarUrl: placeholderAvatar("Fredrik Ekholdt"),
  },
};

/**
 * Ids of items worth selecting from a story control.
 *
 * Exported because the ids are source paths now, which are too long to retype
 * in a story's `argTypes` and too easy to get subtly wrong.
 */
export const mockSelectionIds = {
  home: mockPages[0].id,
  pricing: mockPages[3].id,
  firstBlogPost: blogPosts[0].id,
  products: "/content/shop/products.val.ts",
  images: "/content/media.val.ts",
  instagram: mockExternalPages[0].id,
} satisfies Record<string, string>;

/**
 * A project that has a router but nothing in it yet.
 *
 * `hasRouters` stays true while `pages` is empty, which is the state a project
 * is in between `s.router(...)` being written and the first page being made:
 * the site map is there to add to. Media and Data have no equivalent — a
 * gallery module with no files still shows as a gallery, so an empty `media`
 * means no gallery module exists — which is why this data has neither
 * destination, and why the shell shows only Pages for it.
 */
export const emptyShellData: ShellData = {
  ...mockShellData,
  hasRouters: true,
  pages: [],
  externalPages: [],
  media: [],
  settings: undefined,
  data: [],
  notifications: [],
  activity: [],
  validationErrors: [],
  deployments: [],
};
