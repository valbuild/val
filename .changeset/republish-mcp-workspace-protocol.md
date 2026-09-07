---
"@valbuild/mcp": patch
---

Republish `@valbuild/mcp` with resolvable dependency versions.

`@valbuild/mcp@0.123.0` shipped its manifest with the workspace protocol intact —
`"@valbuild/core": "workspace:*"` and the same for `server` and `shared` — so it
cannot be installed. npm refuses it with
`EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`, and pnpm with
`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. `@valbuild/next@0.123.0` depends on that exact
version, so it could not be installed either.

Both of those versions are deprecated. Use this one.

Nothing in the source was wrong: every package in the repository declares its
siblings as `workspace:*` and the publish step rewrites them to real versions.
That version was published by hand with `npm publish`, which uploads the manifest
verbatim — the rewrite is pnpm's, and only `pnpm publish` (which is what
`changeset publish` runs here) performs it.
