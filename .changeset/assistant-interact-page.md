---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The assistant can now use the page in the preview, not only read it. A new `interact_page` tool opens a path on the site, clicks an element, types into a field, presses a key (Enter, Escape, Tab, the arrows), or shows the page at phone, tablet or desktop width — and answers with the page as it is afterwards: it waits for the page to settle (no changes and no requests in flight for a moment, at most 15 seconds), then gives the page's outline, whether the address or title changed, and what the page logged as going wrong since. When the page is still busy after that, the answer says so instead of describing it as finished. The assistant is told to use it to check its own changes: after a quick preview or a build, open the route, try what changed, and read the log.

The preview is the real site, talking to its real backend. What is enforced:

- **Every click, and every Enter or Space, asks you first.** A card in the chat — written by the Studio, not the assistant — names the element as the page shows it (its label, what it is, the page it is on, and whether Enter would submit its form), and nothing reaches the page until you allow it. Allow does exactly that, once, on that element; if the element changed in the meantime, you are asked again.
- **While the assistant types, presses other keys, or waits for a page it opened or resized to settle,** requests the page makes with any method but `GET`, `HEAD` and `OPTIONS` are held until the page settles, and a card shows each one — its method, its address and an excerpt of what it sends. Allow sends exactly those, as they were; Don't allow, or stopping the answer, drops them and the page sees them fail.
- **Sends of data to another site** (`POST`, `PUT`, `PATCH`, `DELETE`, forms, beacons) are refused, and so are links and forms that go to another site or open a new window. It never types into a password field.
- After a web search in the same answer, the assistant asks before it uses the preview at all.

What is **not** covered:

- requests a page sends while it loads, after `open` or after any navigation, and requests sent later on their own (an autosave after a delay);
- requests made through a `fetch` or `XMLHttpRequest` the page's code captured before the action (some libraries do this), and XHRs opened before it;
- `GET`, `HEAD` and `OPTIONS` requests — a `GET` to another site can still carry data in its address — and image or script loads;
- WebSockets, workers and embedded frames;
- script navigations and redirects, which can still leave the site; and plain links, which can have side effects of their own, such as a logout or unsubscribe link.

The ask-first rule is `interact_page`'s, not the whole session's: `quick_preview` runs code the assistant wrote in the preview, and what that code does is not asked about.

Reading pages needs no permission. Width changes use the preview's own device switch, so you see the same width the assistant does.

Update `@valbuild/next` or `@valbuild/tanstack` together with the Studio to get `interact_page`; with an older one, the tool says at once which package to update.
