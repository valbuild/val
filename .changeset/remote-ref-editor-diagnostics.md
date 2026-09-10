---
"@valbuild/language-server": patch
---

The editor no longer warns "Remote image was not checked." on every remote image
and file.

That message is a placeholder: core cannot reach the content host, so
`s.image().remote()` reports it unconditionally and leaves the real check to
whoever can make it. `val validate` makes it and prints nothing when the ref is
sound; the language server was publishing the placeholder raw, so every remote
image in a project carried a permanent warning that no quick fix could clear.

It is now adjudicated the same way the metadata placeholder already was — by
running Val's own check — so a valid ref reports nothing, and a ref that no
longer matches the bytes behind it reports what the CLI reports:

```
Remote ref: https://remote.val.build/file/p/…/renaming.gif is not valid. Use the --fix flag to fix this issue.
```

Nothing is downloaded for a ref that still adds up; only a stale one is fetched,
into the same `.val/remote-file-cache` the CLI uses.
