import type { ServerOptions } from "vite";

/**
 * Where `vite dev` serves the Studio while Val itself is being developed
 * (`pnpm --filter @valbuild/ui run dev`): the server `createUIRequestHandler`
 * forwards `/api/val/static` to, and the one `vite.config.mts` starts.
 *
 * One number for both, because the app proxies to it by address: a dev
 * server that moved to the next free port would leave the app asking a
 * different process for the Studio's code.
 */
export const SPA_DEV_PORT = 5173;

/** {@link SPA_DEV_PORT} as the origin the app's proxy fetches from. */
export const SPA_DEV_ORIGIN = `http://localhost:${SPA_DEV_PORT}`;

/**
 * `server` for the Studio's `vite dev`.
 *
 * ## Why the HMR socket is pointed at this server, not at the page
 *
 * The browser loads the Studio from the APP's origin (`/api/val/static` on
 * Next's or TanStack's port), so Vite's client, left to itself, opens its
 * socket there: `ws://localhost:3456/api/val/static/?token=…`. The app's
 * route is an HTTP proxy and cannot upgrade it, so Next leaves the handshake
 * unanswered -- and a socket stuck CONNECTING blocks EVERY other WebSocket
 * to that host and port: Chrome opens one handshake per host at a time
 * (RFC 6455, section 4.1). One of those is Next's own HMR socket, and under
 * `next dev` that socket carries the React debug channel the page waits for
 * before it hydrates. So a page loaded beside the Studio -- the canvas --
 * rendered, never hydrated, and never reported to it ("No answer from the
 * page").
 *
 * Vite's client is not loaded by most of the Studio: nothing in it accepts
 * hot updates. A dynamic `import()` of a computed URL is enough, though --
 * in dev Vite rewrites it to call `injectQuery` from `/@vite/client` -- and
 * the first one (`importBundle`, `stagedCode.ts`) is what turned this on.
 *
 * `clientPort` sends the socket to this server, which answers it. `hmr:
 * false` keeps what the Studio had before it was loaded: no reload of an
 * open Studio when a file changes. `strictPort`, because the app proxies to
 * {@link SPA_DEV_PORT} by number.
 */
export const spaDevServerOptions: ServerOptions = {
  port: SPA_DEV_PORT,
  strictPort: true,
  hmr: false,
  ws: { clientPort: SPA_DEV_PORT },
};
