import { execFileSync } from "node:child_process";
import path from "node:path";
import { createUIRequestHandler } from "./server";

/**
 * The Studio's `vite dev` hands its HMR socket an address the app does not
 * stand in front of.
 *
 * The Studio is loaded from the APP's origin, through the app's
 * `/api/val/static` proxy (`createUIRequestHandler`). A Vite client left to
 * itself opens its socket on that origin, which cannot upgrade it, and a
 * WebSocket stuck CONNECTING holds up every other WebSocket to that host in
 * Chrome -- Next's HMR socket among them, which `next dev` delivers the
 * React debug channel through. The canvas's page then never hydrated. See
 * `spaDevServerOptions`.
 *
 * What is checked is what the browser would be told: the server the proxy
 * really fetches from, and the socket address in the config Vite really
 * resolves from `vite.config.mts`.
 */

const PACKAGE_DIR = path.resolve(__dirname, "..");

/** The port `createUIRequestHandler` forwards `/api/val/static` to. */
async function proxiedPort(): Promise<string> {
  const requested: string[] = [];
  const realFetch = global.fetch;
  global.fetch = async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response("", { status: 200 });
  };
  try {
    await createUIRequestHandler()(
      "/spa/main.jsx",
      "http://localhost:3456/api/val/static/spa/main.jsx",
    );
  } finally {
    global.fetch = realFetch;
  }
  expect(requested).toHaveLength(1);
  return new URL(requested[0]).port;
}

type ResolvedServer = {
  port: number | undefined;
  strictPort: boolean | undefined;
  ws: false | { clientPort?: number; port?: number; host?: string };
};

/**
 * `server` as `vite dev` resolves it from `vite.config.mts`.
 *
 * In a child process because Vite is ESM-only and this jest is CommonJS:
 * `resolveConfig` loads the config file exactly as `vite` does, without
 * starting a server.
 */
function resolvedServer(): ResolvedServer {
  const script = `
    import { resolveConfig } from "vite";
    const config = await resolveConfig(
      { configFile: "vite.config.mts", logLevel: "silent" },
      "serve",
    );
    const { port, strictPort, ws } = config.server;
    process.stdout.write(JSON.stringify({ port, strictPort, ws }));
  `;
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { cwd: PACKAGE_DIR, encoding: "utf-8" },
  );
  return JSON.parse(out);
}

test("the HMR socket goes to the server the app proxies the Studio from", async () => {
  const port = await proxiedPort();
  const server = resolvedServer();
  // Started where the proxy looks, and nowhere else.
  expect(String(server.port)).toBe(port);
  expect(server.strictPort).toBe(true);
  // The socket is told that port. Without it, Vite's client takes the
  // page's: the app's, where the handshake is never answered.
  expect(server.ws).not.toBe(false);
  const ws = server.ws === false ? {} : server.ws;
  expect(String(ws.clientPort ?? ws.port)).toBe(port);
  expect(ws.host ?? "localhost").toBe("localhost");
}, 60_000);
