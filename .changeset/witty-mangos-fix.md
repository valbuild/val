---
"@valbuild/ui": patch
---

Fix client-side validation worker failing to load ("Unexpected token '<'"). The worker was reached via a dynamic import, which Vite emitted as a code-split chunk resolved relative to the entry's served URL (`/api/val/static/{version}/app`) rather than its real `/assets/` location, so the request returned the SPA HTML shell instead of JavaScript. The worker is now created with `new URL("./validation.worker.ts", import.meta.url)` like the search and patchsets workers (an absolute asset URL), and the worker factory is injected from the composition root so it loads reliably regardless of where the SPA entry is served.
