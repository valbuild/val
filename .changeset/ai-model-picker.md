---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

The assistant lets you pick which model answers, from the models your key can
actually reach.

The content server now asks each provider what a key may use and reports the
answer; the Studio offers exactly that, beside the composer. Which model to use
is a per-message decision — something cheap for a typo, something strong for a
hard question — so the control sits where the message is written rather than in
a settings panel.

The choice is remembered per browser and re-checked against what is on offer
each time the assistant starts, so a model an account has lost access to is
quietly replaced instead of being sent and refused.

A content server that does not report models, or could not reach a provider,
leaves the built-in catalog as the fallback, filtered to reachable providers.
