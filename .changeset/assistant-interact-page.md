---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The assistant can now use the page in the preview, not only read it. A new `interact_page` tool opens a path on the site, clicks an element, types into a field, presses a key (Enter, Escape, Tab, the arrows), or shows the page at phone, tablet or desktop width — and answers with the page as it is afterwards: it waits for the page to settle (no changes and no requests in flight for a moment, at most 15 seconds), then gives the page's outline, whether the address or title changed, and what the page logged as going wrong since. When the page is still busy after that, the answer says so instead of describing it as finished. The assistant is told to use it to check its own changes: after a quick preview or a build, open the route, try what changed, and read the log.

The preview is the real site, talking to its real backend, so:

- **Nothing is sent to your site's server without you.** While the assistant clicks, types or presses a key, anything the page tries to send because of it — a form submit, or any request other than a `GET`, however the page makes it — is held unsent, and a card in the chat shows exactly what the page tried (the method and the address). The card's words are the Studio's, not the assistant's. Allow sends exactly those requests; Don't allow, or stopping the answer, drops them and the page sees them fail.
- **It never types into a password field**, and **never takes the preview off the site**: links to other sites or new windows are refused, and data the page tries to send to another site is never sent.
- After a web search in the same answer, the assistant asks before it uses the preview at all.

Reading pages, plain links, typing, keys and width changes need no permission. Width changes use the preview's own device switch, so you see the same width the assistant does.

Update `@valbuild/next` or `@valbuild/tanstack` together with the Studio to get `interact_page`; with an older one, the tool says at once which package to update.
