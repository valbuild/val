---
"@valbuild/language-server": minor
"@valbuild/server": minor
"@valbuild/cli": minor
"@valbuild/next": minor
---

Add `@valbuild/language-server` — a Language Server Protocol server that ships with Val, so a single editor extension works against any Val version.

The package is a dependency of `@valbuild/next` and `@valbuild/cli`, so it is present in every Val project. Editors resolve it from the project's `node_modules` and launch its `val-language-server` binary; it can also be started by hand with `val lsp --stdio`. Client and server agree on a protocol version during `initialize`, and the server announces its capabilities as feature flags so a newer Val degrades gracefully against an older editor client instead of breaking.

Also exported from `@valbuild/server` the building blocks editor tooling needs, so quick fixes can take the same code path as `val validate --fix` rather than reimplementing it: `extractImageMetadata`, `extractFileMetadata`, `validateMetadata`, `getValidationErrorFileRef`, `checkRemoteRef`, `downloadFileFromRemote`, `getCachedRemoteFileDir`, `getCachedRemoteFilePath`, `hasRemoteFileSchema`, `getFileExt`, `evalValConfigFile`, `findAndEvalValConfigFile`, and the login device flow (`startValLogin`, `awaitValLoginConfirmation`, `persistPersonalAccessToken`).
