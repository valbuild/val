---
"@valbuild/core": patch
---

External page keys are now validated, and `mailto:` and `tel:` are allowed.

`externalPageRouter` documented a rule — a key must start with `https://` or
`http://` — and never enforced it: the validator collected the errors and then
returned an empty list, so a key like `discord.gg/val` or `/about` was accepted
in silence and behaved as a relative link on the site.

Fixing that made the rule itself worth looking at, because it was a rule about
the protocol standing in for a rule about links. A contact page's email address
and phone number are external pages to whoever maintains the list, and they
were refused. So the rule that is now enforced is a deny list rather than an
allow list: a key must have a scheme, and the scheme must not be one of
`javascript:`, `data:`, `vbscript:`, `file:` or `blob:` — which are not links
at all. An external page key ends up in an `href` in your site's own markup, so
those stay refused however the router is configured.

A project that wants to be stricter says so:

```ts
s.record(item).router(externalPageRouter({ schemes: ["https", "mailto"] }));
```

Val Studio applies the same rule while you type — it calls the same function —
and shows a narrowed project's own list in the message.

If your project has a key with no scheme at all, it will start showing a
validation error on that entry. Give it one, or move it out of the external
router.
