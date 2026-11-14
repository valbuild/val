---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The assistant can now use the page in the preview, not only read it. A new `interact_page` tool opens a path on the site, clicks an element, types into a field, presses a key (Enter, Escape, Tab, the arrows), or shows the page at phone, tablet or desktop width — and answers with the page as it is afterwards: it waits for the page to settle (no changes and no requests in flight for a moment, at most 15 seconds), then gives the page's outline, whether the address or title changed, and what the page logged as going wrong since. When the page is still busy after that, the answer says so instead of describing it as finished. The assistant is told to use it to check its own changes: after a quick preview or a build, open the route, try what changed, and read the log.

The preview is the real site, talking to its real backend, so:

- **Every click, and every Enter or Space, asks you first.** A card in the chat — written by the Studio, not the assistant — names the element as the page shows it (its label, what it is, the page it is on), and nothing reaches the page until you allow it. Allow does exactly that, once, on that element; if the page changed in the meantime, you are asked again.
- **While the assistant types, presses other keys, opens a page or changes the width,** requests the page makes that send data (anything but `GET`) are held until the page settles, and a card shows each one — its method, its address and an excerpt of what it sends. Allow sends exactly those; Don't allow, or stopping the answer, drops them and the page sees them fail.
- **It never types into a password field**, and **never takes the preview off the site**: links to other sites or new windows are refused, and data the page tries to send to another site is never sent.
- After a web search in the same answer, the assistant asks before it uses the preview at all.

What is not covered: requests a page sends later on its own (an autosave after a delay), WebSockets, workers, embedded frames, and plain links and other `GET` navigations — which can still have side effects, such as a logout or unsubscribe link.

Reading pages needs no permission. Width changes use the preview's own device switch, so you see the same width the assistant does.

Update `@valbuild/next` or `@valbuild/tanstack` together with the Studio to get `interact_page`; with an older one, the tool says at once which package to update.
