---
"@valbuild/ui": patch
---

The deploy feed is the last few publishes, with no rows to dismiss

Every row in the deploy list carried a dismiss button, and the shell and the
provider each kept a set of dismissed commits to subtract from the feed. That
control existed because the list grew: the client accumulated every deployment
and commit a session had ever seen, so a tab left open all day ended up with a
list only clearing could shorten.

The feed is bounded now — the content service returns the most recent publishes,
and the client keeps the newest few of those — so there is nothing to tidy: what
a row would be dismissed for is that it is old, and being old is what takes it
off the end of the list on its own. The list still closes on its own once
everything has landed, on Escape, and on a click outside.

One behaviour follows from the feed carrying history: the list no longer opens
itself for an old publish. It used to treat anything Val had not seen serving
the site as news, which was true when the feed only held the publishes on the
current chain — now that it holds the last few, "not live" is the resting state
of every publish that has been superseded, and opening Val would have announced
a build from last week. Freshness decides it instead.
