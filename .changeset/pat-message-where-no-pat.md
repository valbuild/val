---
"@valbuild/server": patch
"@valbuild/ui": patch
---

Stop telling people to run `val login` where a personal access token cannot be used

A PAT is read from a file in the *server's* working directory, and only local
`fs` mode has one. `resolveRemoteFileAuth` knew that; two things upstream did not.

`RemoteFilesErrorDialog` was unconditional. Whatever went wrong with remote files,
it said "Personal access token file required" and told the reader to run a command
in their project root — for a server with no working directory, a directory that
does not exist, to produce a file it could not read. The reason was already on the
error object and simply never looked at. The dialog now shows only for the two
reasons a PAT can actually fix, and everything else gets its own message.

`resolveRemoteFileAuth` also answered `project-not-configured` for a non-fs mode
with no api key, which is wrong twice: the project may be configured perfectly
well, and it is the credential that is absent. It answers `api-key-missing` now,
already in the wire contract, and that message no longer says "production mode",
because every server that is not local dev gives it.
