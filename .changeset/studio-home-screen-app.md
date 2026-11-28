---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

The Studio can be added to the home screen. It then opens full screen at `/val`, without the browser's address bar, and starts faster.

- **Install it from the account panel**, under **This device**. In Chrome, Edge and on Android, the button opens the browser's install dialog. In Safari on iPhone and iPad, it shows the two taps that do it from the Share menu.
- **One app per site.** The Studio and its sign-in live on your site's own domain, so each site gets its own icon, named after its host.
- **Faster start.** A service worker scoped to `/val` caches the Studio's own versioned scripts and styles, and keeps the last Studio page so the app still opens without a network. Content, drafts and patches are never cached.
- **Nothing to set up.** The manifest, icons and worker are served by the `/api/val` route your app already has.
