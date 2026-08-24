import {
  ShellActivityEntry,
  ShellChatMessage,
  ShellData,
  ShellDataModule,
  ShellExternalPage,
  ShellMediaGallery,
  ShellNotification,
  ShellPage,
  ShellValidationError,
} from "./types";

/**
 * Mock data for the shell stories.
 *
 * Sized to be realistic rather than pretty: real projects have dozens of
 * pages and a long tail of external links, and the panels have to stay
 * usable at that size.
 */

const blogPosts: ShellPage[] = [
  "Why we built Val",
  "Git-based content, explained",
  "Type-safe content for Next.js",
  "Shipping a CMS without a database",
  "Content modelling for developers",
  "Structured content in TypeScript",
  "Migrating from a headless CMS",
  "Validation as a content feature",
  "Draft previews without a preview server",
  "Editing in place",
  "The case against page builders",
  "Localisation without lock-in",
].map((name, i) => ({
  id: `blog-${i}`,
  name,
  urlPath: `/blog/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  hasDraft: i === 0 || i === 4,
  errorCount: i === 7 ? 1 : undefined,
}));

const caseStudies: ShellPage[] = [
  "Nordic Retail",
  "Bergen Energy",
  "Fjord Logistics",
  "Aurora Bank",
  "Vestland Municipality",
  "Polar Media",
].map((name, i) => ({
  id: `case-${i}`,
  name,
  urlPath: `/customers/${name.toLowerCase().replace(/\s+/g, "-")}`,
  hasDraft: i === 2,
}));

const docsPages: ShellPage[] = [
  "Getting started",
  "Installation",
  "Schemas",
  "Modules",
  "Rich text",
  "Images and files",
  "Remote files",
  "Validation",
  "Patches",
  "CLI",
  "Deployment",
  "API reference",
].map((name, i) => ({
  id: `docs-${i}`,
  name,
  urlPath: `/docs/${name.toLowerCase().replace(/\s+/g, "-")}`,
  errorCount: i === 6 ? 2 : undefined,
}));

export const mockPages: ShellPage[] = [
  { id: "home", name: "Home", urlPath: "/", hasDraft: true },
  { id: "about", name: "About", urlPath: "/about" },
  { id: "product", name: "Product", urlPath: "/product" },
  { id: "pricing", name: "Pricing", urlPath: "/pricing", hasDraft: true },
  {
    id: "features",
    name: "Features",
    urlPath: "/features",
    children: [
      { id: "feat-editor", name: "Editor", urlPath: "/features/editor" },
      { id: "feat-ai", name: "AI", urlPath: "/features/ai" },
      {
        id: "feat-validation",
        name: "Validation",
        urlPath: "/features/validation",
        errorCount: 1,
      },
      { id: "feat-git", name: "Git workflow", urlPath: "/features/git" },
    ],
  },
  { id: "blog-index", name: "Blog", urlPath: "/blog", children: blogPosts },
  {
    id: "customers",
    name: "Customers",
    urlPath: "/customers",
    children: caseStudies,
  },
  { id: "docs", name: "Docs", urlPath: "/docs", children: docsPages },
  { id: "changelog", name: "Changelog", urlPath: "/changelog" },
  { id: "careers", name: "Careers", urlPath: "/careers" },
  { id: "contact", name: "Contact", urlPath: "/contact" },
  { id: "privacy", name: "Privacy policy", urlPath: "/legal/privacy" },
  { id: "terms", name: "Terms of service", urlPath: "/legal/terms" },
  { id: "cookies", name: "Cookie policy", urlPath: "/legal/cookies" },
];

export const mockExternalPages: ShellExternalPage[] = [
  { id: "ext-ig", name: "Instagram", url: "https://instagram.com/valbuild" },
  { id: "ext-li", name: "LinkedIn", url: "https://linkedin.com/company/val" },
  { id: "ext-x", name: "X", url: "https://x.com/valbuild" },
  { id: "ext-gh", name: "GitHub", url: "https://github.com/valbuild/val" },
  { id: "ext-yt", name: "YouTube", url: "https://youtube.com/@valbuild" },
  {
    id: "ext-portal",
    name: "Customer portal",
    url: "https://portal.example.com",
  },
  { id: "ext-status", name: "Status page", url: "https://status.example.com" },
  { id: "ext-support", name: "Support", url: "https://support.example.com" },
  { id: "ext-shop", name: "Shop", url: "https://shop.example.com" },
  {
    id: "ext-jobs",
    name: "Job listings",
    url: "https://jobs.example.com/val",
    errorCount: 1,
  },
  { id: "ext-community", name: "Community", url: "https://discord.gg/val" },
  { id: "ext-newsletter", name: "Newsletter", url: "https://val.substack.com" },
];

export const mockMedia: ShellMediaGallery[] = [
  {
    id: "media-images",
    name: "Images",
    directory: "/public/val/images",
    itemCount: 184,
    mediaType: "images",
  },
  {
    id: "media-illustrations",
    name: "Illustrations",
    directory: "/public/val/illustrations",
    itemCount: 42,
    mediaType: "images",
  },
  {
    id: "media-people",
    name: "People",
    directory: "/public/val/people",
    itemCount: 27,
    mediaType: "images",
  },
  {
    id: "media-docs",
    name: "Documents",
    directory: "/public/val/docs",
    itemCount: 9,
    mediaType: "files",
  },
];

export const mockDataModules: ShellDataModule[] = [
  {
    id: "data-settings",
    name: "Site settings",
    moduleFilePath: "/content/settings.val.ts",
  },
  {
    id: "data-nav",
    name: "Navigation",
    moduleFilePath: "/content/navigation.val.ts",
    hasDraft: true,
  },
  {
    id: "data-footer",
    name: "Footer",
    moduleFilePath: "/content/footer.val.ts",
  },
  {
    id: "data-products",
    name: "Products",
    moduleFilePath: "/content/products.val.ts",
    errorCount: 3,
  },
  {
    id: "data-authors",
    name: "Authors",
    moduleFilePath: "/content/authors.val.ts",
  },
  {
    id: "data-redirects",
    name: "Redirects",
    moduleFilePath: "/content/redirects.val.ts",
  },
  {
    id: "data-i18n",
    name: "Translations",
    moduleFilePath: "/content/i18n.val.ts",
  },
];

export const mockNotifications: ShellNotification[] = [
  {
    id: "n1",
    kind: "content",
    title: 'Page "Home" was updated',
    timestamp: "2 minutes ago",
    unread: true,
  },
  {
    id: "n2",
    kind: "media",
    title: 'Media "hero-dark.png" uploaded',
    timestamp: "10 minutes ago",
    unread: true,
  },
  {
    id: "n3",
    kind: "validation",
    title: "3 validation errors in Products",
    timestamp: "24 minutes ago",
    unread: true,
  },
  {
    id: "n4",
    kind: "content",
    title: 'Data "navigation" was updated',
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
    title: 'Page "Pricing" was created',
    timestamp: "Yesterday",
  },
];

export const mockValidationErrors: ShellValidationError[] = [
  { id: "v1", title: "Products", detail: "/content/products.val.ts", count: 3 },
  {
    id: "v2",
    title: "Docs › Remote files",
    detail: "/docs/remote-files",
    count: 2,
  },
  {
    id: "v3",
    title: "Features › Validation",
    detail: "/features/validation",
    count: 1,
  },
  {
    id: "v4",
    title: "External › Job listings",
    detail: "https://jobs.example.com/val",
    count: 1,
  },
];

export const mockActivity: ShellActivityEntry[] = [
  {
    id: "a1",
    title: "Home › Hero › Title",
    timestamp: "2 minutes ago",
    author: "You",
  },
  {
    id: "a2",
    title: "Pricing › Plans",
    timestamp: "18 minutes ago",
    author: "You",
  },
  {
    id: "a3",
    title: "Navigation › Primary",
    timestamp: "1 hour ago",
    author: "Ada L.",
  },
  {
    id: "a4",
    title: "Blog › Why we built Val",
    timestamp: "Yesterday",
    author: "Ada L.",
  },
];

export const mockChat: ShellChatMessage[] = [
  {
    id: "c1",
    role: "user",
    text: "Make the hero heading shorter and a bit punchier.",
  },
  {
    id: "c2",
    role: "assistant",
    text: "Here is a shorter heading. It keeps the promise but drops the qualifier.",
    proposal: {
      target: "Home › Hero › Title",
      content: "Build better websites",
      actions: ["apply", "replace", "try-another"],
    },
  },
];

export const mockChatSuggestions: string[] = [
  "Improve this page",
  "Make this heading shorter",
  "Write a meta description",
  "Suggest sections",
];

export const mockShellData: ShellData = {
  projectName: "val-demo-project",
  branch: "main",
  repositoryUrl: "https://github.com/valbuild/val",
  pages: mockPages,
  externalPages: mockExternalPages,
  media: mockMedia,
  data: mockDataModules,
  notifications: mockNotifications,
  activity: mockActivity,
  validationErrors: mockValidationErrors,
  chat: mockChat,
  chatSuggestions: mockChatSuggestions,
  user: {
    name: "Fredrik Ekholdt",
    initials: "FE",
    email: "fredrik@valbuild.com",
  },
};

/** An empty project — used to check the shell's empty states. */
export const emptyShellData: ShellData = {
  ...mockShellData,
  pages: [],
  externalPages: [],
  media: [],
  data: [],
  notifications: [],
  activity: [],
  validationErrors: [],
  chat: [],
};
