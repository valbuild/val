---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/cli": patch
---

Remote galleries (`s.images({ remote: true })` / `s.files({ remote: true })`) now report a fixable validation error when an entry is still a local path, mirroring the single-field `s.image().remote()` / `s.file().remote()` behaviour. Running the CLI with `validate --fix` uploads the file to remote storage and rewrites the record key from the local path to the remote URL, keeping the file on disk. The gallery "untracked files" check now recognizes a remote-URL key as covering its on-disk file, so kept files are not flagged.

Adds two new validation fixes: `images:upload-remote` and `files:upload-remote`.
