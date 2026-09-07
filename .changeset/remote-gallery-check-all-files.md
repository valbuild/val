---
"@valbuild/server": patch
---

Stop `val validate` reporting published remote gallery images as missing — and `--fix` deleting them

A remote gallery (`s.images({ remote: true })`) keys an uploaded entry by its
remote URL. Two separate checks read that key, normalised it back to the local
path it encodes, and then required a file to be sitting there:

- `val validate` reported _"Gallery … has tracked files that do not exist on
  disk"_ for every published remote image;
- `val validate --fix` **removed the entry from the gallery**, silently deleting
  the reference to a file that was safely on the content host.

Both were wrong for the same reason. Publishing uploads remote files to the
content host and copies only local ones into the working tree, so an image added
through the Studio — or over MCP — has no file in the repo by design. Putting one
there is exactly what remote storage exists to avoid.

Remote entries are now exempt from both the missing-file check and the
metadata-from-disk verification. Whether a remote entry is sound is
`image:check-remote`'s question, and it already asks it. Nothing changes for
local entries, or for a remote entry that does have a local file — `--fix`
promotes a local file to a remote ref and leaves the file where it was, and that
file is still counted as tracked rather than reported as untracked.
