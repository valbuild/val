import { modules } from "@valbuild/tanstack";
import { config } from "./val.config";

/**
 * The end-to-end suite's fixtures: `content/`, the shapes the Playwright specs
 * drive (`e2e/`), which a showcase has no reason to show.
 *
 * Off unless the suite's own servers turn it on (`playwright.config.ts`), so a
 * plain `pnpm dev` and `vite build` of this app are the showcase and nothing
 * else. The same expression is read in three places, and has to give one
 * answer in all of them: the server, the Studio in the browser (which is handed
 * these modules too) and `val validate`, which evaluates this file in a
 * `node:vm` sandbox with the real `process`. `vite.config.ts` inlines it for
 * the first two, where there is no `process.env` to read.
 */
const e2eFixtures = process.env.VAL_E2E_FIXTURES === "true";

/**
 * The fixtures' REMOTE media, separately: a remote schema anywhere in a project
 * makes the Studio ask for remote settings and makes every publish require
 * remote credentials, so only the proxy-mode server, whose mock content host
 * answers both, turns this on. See `content/remoteImages.val.ts`.
 */
const e2eRemoteMedia =
  e2eFixtures && process.env.VAL_E2E_REMOTE_MEDIA === "true";

export default modules(config, [
  // The project's settings: one per project, at the root of the content tree.
  { def: () => import("./settings.val") },
  // A route module sits beside the route file it serves and is named after it.
  { def: () => import("./src/routes/_site.index.val") },
  { def: () => import("./src/routes/_site.posts.$postId.val") },
  { def: () => import("./src/routes/_site.docs.$.val") },
  { def: () => import("./src/routes/_site.showcase.val") },
  // A route whose URL names its language: `/news/…` and `/nb/news/…`.
  { def: () => import("./src/routes/_site.{-$locale}.news.$slug.val") },
  // A page behind the site's own login. See src/auth/session.ts.
  { def: () => import("./src/routes/_site.dashboard.val") },
  // Ordinary content modules live wherever you like.
  { def: () => import("./src/content/authors.val") },
  { def: () => import("./src/content/site.val") },
  { def: () => import("./src/content/theme.val") },
  // `s.int()` and `s.number()`, with min/max/step and the slider render.
  { def: () => import("./src/content/layout.val") },
  // Media: the two collections first, then the fields that point into them.
  { def: () => import("./src/content/gallery.val") },
  { def: () => import("./src/content/downloads.val") },
  { def: () => import("./src/content/fonts.val") },
  { def: () => import("./src/content/media.val") },
  // `s.video()`: an mp4 and an HLS stream — and, like the images above, a
  // collection first and then the fields that pick from it.
  { def: () => import("./src/content/videos.val") },
  { def: () => import("./src/content/video.val") },
  // Pages that are not in this app, keyed by their whole URL.
  { def: () => import("./src/content/links.val") },
  // Entries in files of their own, loaded one at a time.
  { def: () => import("./src/content/kb.val") },
  // The two ways content says what language it is in.
  { def: () => import("./src/content/translated.val") },
  // `readonly()` and `hidden()`, which only the Studio enforces.
  { def: () => import("./src/content/access.val") },
  // Hidden from the nav, reached through the `s.view()` row on access.val.ts.
  { def: () => import("./src/content/roster.val") },
  ...(e2eFixtures
    ? [
        { def: () => import("./content/authors.val") },
        { def: () => import("./content/media.val") },
        { def: () => import("./content/theme.val") },
        { def: () => import("./content/kb.val") },
        { def: () => import("./content/jsonEntryMedia.val") },
        { def: () => import("./content/tags.val") },
        { def: () => import("./content/translated.val") },
        { def: () => import("./content/handbook.val") },
        { def: () => import("./content/mediaFixtures.val") },
        { def: () => import("./content/fileGallery.val") },
        { def: () => import("./content/mediaFields.val") },
        { def: () => import("./content/encodedImages.val") },
        { def: () => import("./content/encodedFields.val") },
        { def: () => import("./content/access.val") },
        { def: () => import("./content/lists.val") },
      ]
    : []),
  ...(e2eRemoteMedia
    ? [
        { def: () => import("./content/remoteImages.val") },
        { def: () => import("./content/remoteFields.val") },
      ]
    : []),
]);
