/**
 * The document the draft-mode iframe lands on, and the message it sends back.
 *
 * Turning draft mode on in a Next app has to happen server-side, so Val does it
 * by pointing a hidden iframe at `/api/val/draft/enable`, which flips the flag
 * and redirects. Something then has to load and say "done" — and that used to be
 * the entire `/val` Studio route, via `ValApp`'s `?message_onready=true` branch.
 *
 * Loading a Next route to send one message is not just wasteful, it reloads the
 * Studio. `next dev` answers a NEW client connecting by *broadcasting* a `sync`
 * carrying the current webpack compilation hash (`publish`, not a reply to the
 * connecting client — see `next/dist/server/dev/hot-middleware.js`), and every
 * other document's HMR client reloads itself if that hash differs from the one
 * it recorded, on the theory that the dev server restarted (see
 * `next/dist/client/dev/hot-reloader/app/web-socket.js`). So any Next document
 * Val opens while the hash has moved takes the Studio down with it.
 *
 * This document is served by the API route as plain HTML. It carries no Next
 * client bundle, so it opens no HMR socket, so it provokes no broadcast.
 */

/** Appended to the Val API route, e.g. `/api/val/draft/ready`. */
export const VAL_DRAFT_READY_PATH = "/draft/ready";

/** The `postMessage` type the ready document sends to its parent. */
export const VAL_READY_MESSAGE_TYPE = "val-ready";
