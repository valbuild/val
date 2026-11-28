---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/core": patch
---

The Studio can be added to the home screen. It then opens full screen at `/val`, without the browser's address bar, and starts faster.

- **Install it from the account panel**, under **This device**: **Install app** on a computer, **Add to home** on a phone. In Chrome, Edge and on Android it opens the browser's install dialog. Safari on iPhone and iPad has no such dialog, so it opens a short illustrated guide to the Share menu instead, showing the icon the app will get.
- **Your logo is the icon.** The project's logo from `s.settings()` (`theme.logo`) becomes the app's icon once it is published, if it is an SVG or a square image of at least 144 pixels (512 is best). Otherwise the icon is Val's.
- **One app per site.** The Studio and its sign-in live on your site's own domain, so each site gets its own icon, named after its host.
- **Faster start.** In the installed app, a service worker scoped to `/val` caches the Studio's own versioned scripts and styles, and keeps the last Studio page so the app still opens without a network. Content, drafts and patches are never cached. The Studio in a browser tab is unchanged.
- **Nothing to set up.** The manifest, icons and worker are served by the `/api/val` route your app already has.
