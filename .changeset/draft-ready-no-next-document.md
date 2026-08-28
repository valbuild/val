---
"@valbuild/next": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

Stop the draft-mode handshake loading the whole Studio route

Turning draft mode on in a Next app has to happen server-side, so Val points a
hidden iframe at `/api/val/draft/enable` and waits for something to load and post
`val-ready` back. That something was `/val?message_onready=true` — the entire
Studio route, React tree and SPA script — to send one message.

Being a Next document, it connected a dev HMR client, and that is not free: `next
dev` answers a client connecting by _broadcasting_ a `sync` carrying the current
webpack compilation hash, and every other document reloads itself when that hash
has moved since it last synced. So loading `/val` in a hidden iframe could reload
the Studio the editor was working in.

It now lands on `/api/val/draft/ready`: plain HTML served by the API route, with
no client bundle, so it opens no HMR socket. `ValApp`'s `?message_onready=true`
branch stays for a redirect already in flight, and its `setInterval` — created
with no delay, so it posted as fast as the event loop allowed — now has one and a
bound.

`architecture/quirks.md` records the whole chain, including the part Val cannot
fix (a canvas navigation to a route `next dev` has not compiled yet), and
`e2e/dev-reload.spec.ts` measures it.
