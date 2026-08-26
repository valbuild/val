---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/ui": patch
---

Fix remote files being dropped on publish for `s.images({ remote: true })` and `s.files({ remote: true })`

Two functions answered "does this project use remote files", and they disagreed
about media collections. `hasRemoteFileSchema` (server; gates whether `/save`
demands remote credentials) only recursed into a record's `item`, and a media
collection serializes as a record of metadata with the file named by the key — so
it found no image schema and returned `false`. `findRequiredRemoteFiles` (Studio;
gates the `/remote/settings` fetch) had a `mediaType && remote` branch and returned
`true` for the same schema.

The server's answer was the wrong one, and the failure was silent:
`saveOrUploadFiles` in `skip-remote` mode keeps its loop over remote descriptors
inside the `upload-remote` branch, so every remote file was dropped without an
error and the commit landed a remote ref with no bytes behind it.

There is now one implementation, `hasRemoteFileSchema`, exported from
`@valbuild/core` and used by both. `@valbuild/server` still exports it (now a
re-export), so no import changes are needed.
