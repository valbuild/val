---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The assistant can now see what went wrong on the page in the preview. A new `read_page_log` tool reads the page's console errors and warnings, uncaught exceptions, unhandled promise rejections, images, scripts and stylesheets that did not load, and `fetch` requests that failed or answered 400 or more, so a section that is blank because its component threw no longer looks like a section with nothing in it. Every `read_page` answer also counts them, and names the Val modules the page read. The log is kept only in the Studio's preview, never on a visitor's page, and leaves Val's own requests and log lines out.

The preview now says which requests it answers. When the site runs an older `@valbuild/next` or `@valbuild/tanstack` than the Studio, a page tool it cannot answer fails at once with which package to update, and to which version, instead of waiting for an answer that never comes. Update `@valbuild/next` or `@valbuild/tanstack` together with the Studio to get `read_page_log`.
