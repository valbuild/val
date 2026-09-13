---
"@valbuild/ui": patch
---

Fix the Studio crashing with `crypto.randomUUID is not a function` when it is
opened over plain http on something that is not `localhost`

Opening `/val` at an address like `http://172.23.135.172:3000` — a LAN IP, a
VM, or a dev server inside WSL viewed from a browser on Windows — left a blank
screen and this in the console:

```
crypto.randomUUID is not a function
```

`crypto.randomUUID` is secure-context only: it exists on `https://` and on
`localhost`, and is simply absent anywhere else. The Studio called it while
rendering, to name its websocket connection, so it died before it drew
anything. Every id the Studio generates this way now goes through a fallback
that works in any context. `navigator.clipboard`, which is secure-context only
for the same reason, got the same treatment — copying a code block out of the
assistant no longer throws there either.

The fallback is `crypto.getRandomValues`, which exists in an insecure context
and is still cryptographically secure — which matters, because a patch id is
what `/api/val/files` accepts instead of authentication when it serves an
unpublished file. Where a browser has neither that nor `crypto.randomUUID`, the
Studio now says so rather than inventing a guessable id.

This is not specific to any framework, but it shows up most with TanStack
Start: `vite dev` binds `localhost` only, so a WSL user who wants to see the
site from Windows runs it with `--host` and opens the VM's IP, while `next dev`
binds `0.0.0.0` and `localhost` keeps working.
