---
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/ui": patch
---

The design tab can point the assistant at anything on the page. Hold ⌥ (Alt) and click any element in the preview, or press **Select** first: the element under the pointer is outlined and named, and the one picked is shown above the assistant and sent with the next message. A **Pages** menu shows any of the site's pages in the preview, and **Publish** publishes the proposal from the tab, the same way its own Studio does. The checks are now a single quiet status beside the proposal's name, the history is behind a button, and the changed files are listed in the Changes view instead of a panel of their own.

The picking runs in the proposal's own page, through the canvas bridge in `@valbuild/next` and `@valbuild/tanstack`, so a site needs those packages at this version for picking to work in its design tab.
