---
"@valbuild/language-server": patch
---

Editor clients: resolve the language server through `@valbuild/tanstack` too

`@valbuild/language-server` ships inside Val's framework bindings and its CLI —
`@valbuild/next`, `@valbuild/tanstack` and `@valbuild/cli` — but the resolution
recipes in this package's README, which exist to be copied into an editor
client, only ever anchored on `next` and `cli`.

Under pnpm's isolated `node_modules` a transitive dependency is reachable _only_
through a package the project declares, so a client built from those snippets
finds nothing at all in a TanStack Start project. The Neovim configuration in
here then tells the user to upgrade `@valbuild/next` — a package they do not
have and should not add.

The snippets now anchor on `@valbuild/tanstack` as well, and point at the better
version of the rule: read the project's own `@valbuild/*` dependencies out of its
`package.json` and try those first, so the framework binding after this one works
with no client release. Docs only — the server itself is unchanged, and the VS
Code extension already resolved this way.
