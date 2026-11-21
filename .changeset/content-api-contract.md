---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/cli": patch
"@valbuild/ui": patch
"@valbuild/language-server": patch
"@valbuild/mcp": patch
---

Val now speaks the first locked version of Val Build's content API.

- Every request to Val Build says which version of the API it was written for (`val-version: 2026-11-02`). A server that does not serve that version answers with a message saying which side to update.
- Val's headers are now spelled `val-*`. The old `x-val-*` names are still sent beside them, so it does not matter whether Val Build or your app is updated first.
- A `val login` token is now sent as `Authorization: Bearer`, like every other credential. New tokens start with `val_pat_`, and `val publish` recognises them when one lands in `VAL_PROJECT_TOKEN` by mistake.
- `VAL_HOST` points every part of Val at a self-hosted installation in one setting: content, remote files and sign-in. `VAL_CONTENT_URL`, `VAL_REMOTE_HOST` and `VAL_BUILD_URL` still override each one.
