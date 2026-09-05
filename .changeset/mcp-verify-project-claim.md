---
"@valbuild/next": patch
---

MCP: an access token now has to say which Val project it was approved for, and
the endpoint checks it.

Val's authorization server stamps a `val_project` claim (`org/name`) on every
access token, and `@valbuild/next` refuses a token whose claim is not the
project this app is configured for. The project comes from `val.config.ts` (or
`VAL_PROJECT`), not from the `oauth` block, so there is nothing extra to
configure and nothing to get wrong.

**Why, when `aud` already binds the token to this address.** It binds it to the
_address_; what binds the address to a project is a registration at the
authorization server, which this app cannot see. If that binding is ever wrong —
a mistaken entry, a domain that changed hands, an origin registered by the wrong
project — a token approved by a member of another organization would arrive here
with a matching `aud` and a signature that verifies, and would be honoured under
this app's own API key against this project's content. With the claim checked,
the worst such a mistake can produce is a refusal.

A token carrying no `val_project` at all is refused rather than accepted for
compatibility: "accept it if absent" is a downgrade, since anything able to strip
the claim would turn the check off. In practice this means MCP clients holding an
access token minted before this release re-authorize once — access tokens live an
hour, and a refresh mints one with the claim. Local filesystem mode is unaffected:
`project` is optional there, and with nothing to compare against there is no other
tenant for the check to protect.
