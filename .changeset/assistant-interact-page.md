---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The assistant can now use the page in the preview, not only read it. A new `interact_page` tool opens a path on the site, clicks an element, types into a field, presses a key (Enter, Escape, Tab, the arrows), or shows the page at phone, tablet or desktop width — and answers with the page as it is afterwards: it waits for the page to settle (no changes and no requests in flight for a moment, at most 15 seconds), then gives the page's outline, whether the address or title changed, and what the page logged as going wrong since. When the page is still busy after that, the answer says so instead of describing it as finished. The assistant is told to use it to check its own changes: after a quick preview or a build, open the route, try what changed, and read the log.

The preview is the real site, talking to its real backend, so:

- **Submitting a form asks you first.** Clicking a submit button, or pressing Enter in a form's field, shows a card in the chat — written by the Studio, not the assistant — and nothing is sent until you allow it.
- **It never types into a password field**, and **never takes the preview off the site**: links and forms to other sites, and links that open new windows, are refused.

Typing, plain links, buttons outside forms, keys and width changes need no permission. Width changes use the preview's own device switch, so you see the same width the assistant does.

Update `@valbuild/next` or `@valbuild/tanstack` together with the Studio to get `interact_page`; with an older one, the tool says at once which package to update.
