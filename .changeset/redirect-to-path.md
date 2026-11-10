---
"@valbuild/server": patch
"@valbuild/next": patch
---

`/api/val/enable`, `/api/val/disable` and Val's other routes that take `redirect_to` now accept a path on your site, such as `?redirect_to=/blog`, and redirect to it on the same origin. In a Next.js app a path used to answer 500. A value that is neither a path starting with `/` nor an absolute URL is refused with a 400 that says what is accepted.
