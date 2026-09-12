---
"@valbuild/ui": patch
---

The canvas no longer covers the page to say preview mode is off

Whenever the canvas could not do its job, a panel with a blurred backdrop
covered the whole frame. That stopped the canvas being a canvas: the published
page underneath is real and worth reading and scrolling, and none of it was
reachable behind an explanation of why it could not be _edited_. And because
the panel also appeared during ordinary slowness — a first `next dev` compile of
a route, the enable redirect in flight — the normal path to a working canvas ran
through a screen that looked like a failure.

It is a small pill at the top of the canvas viewport now, with the page
untouched behind it. For the first twenty seconds it shows a spinner and says
only that the preview is not ready yet; after that it turns into a warning, with
warning colours, and names what is actually wrong — "Preview mode is off" or "No
answer from the page".

"Turn on preview mode" is on the pill itself, as soon as there is something to
turn on — it is the one thing most people here need, and it is one click. The
explanation, "Reload" and the developer's setup checklist are behind a "Details"
disclosure, so nobody has to read a wiring guide to look at their page.
