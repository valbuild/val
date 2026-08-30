/**
 * @jest-environment node
 */
import { initVal } from "@valbuild/core";
import { initValMcp } from "./initValMcp";

/**
 * What the MCP endpoint refuses, and why each refusal is not optional.
 *
 * These are the only checks between the public internet and a tool that can
 * rewrite a site's content, so each one is tested from the outside — through
 * `valMcpAuthorize`, the way a route calls it — rather than against the
 * predicates it is built from. A guard that is correct in isolation and
 * unreachable in the route is worth nothing.
 */

const { config } = initVal();

function mcp() {
  return initValMcp({ config, modules: [] }, config);
}

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers,
  });
}

/**
 * Run one case with `NODE_ENV` set, restoring it afterwards.
 *
 * Set through the env object rather than assigned, because `NODE_ENV` is typed
 * as a read-only literal union in a Next.js program.
 */
async function withNodeEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  process.env["NODE_ENV"] = value;
  try {
    return await fn();
  } finally {
    process.env["NODE_ENV"] = previous;
  }
}

function httpModeEnv(): Record<string, string | undefined> {
  return {
    VAL_API_KEY: "app-api-key",
    VAL_SECRET: "0".repeat(32),
    VAL_GIT_COMMIT: "0".repeat(40),
    VAL_GIT_BRANCH: "main",
    VAL_PROJECT: "test/project",
  };
}

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("local filesystem mode", () => {
  test("is refused outside development", async () => {
    // The one that matters most: fs mode has no credential and no backend, so a
    // deployed host serving this would be handing anyone who can reach the port
    // write access to the site's content.
    const res = await withNodeEnv("production", async () =>
      mcp().valMcpAuthorize(request({ host: "example.com" })),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(403);
    await expect(res.response.json()).resolves.toEqual({
      error: expect.stringContaining("local filesystem mode"),
    });
  });

  test("is refused outside development even on localhost", async () => {
    // NODE_ENV is the check, not the hostname: a production build serving
    // localhost is still a build with no credential in the path.
    const res = await withNodeEnv("production", async () =>
      mcp().valMcpAuthorize(request({ host: "localhost:3000" })),
    );

    expect(res.status).toBe("refused");
  });

  test("serves a local request in development", async () => {
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "localhost:3000" })),
    );

    // No credential: fs mode writes to the developer's own working tree, and
    // the registry refuses one rather than ignoring it.
    expect(res.status === "ok" && res.ctx).toEqual({
      auth: null,
      sessionId: null,
    });
  });

  test("refuses a request addressed to a non-loopback host", async () => {
    // DNS rebinding: a name the attacker controls resolves to 127.0.0.1, so the
    // request reaches the developer's own dev server while the browser sends
    // the attacker's Host. The listener being local is not evidence the request
    // is.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "rebind.example.com" })),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(403);
  });

  test("accepts the IPv6 loopback address, brackets and port included", async () => {
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "[::1]:3000" })),
    );

    expect(res.status).toBe("ok");
  });
});

describe("cross-origin requests", () => {
  test("a browser's cross-origin Origin is refused", async () => {
    // A page on any origin can fetch a developer's localhost while the app is
    // running, and in fs mode that needs no credential.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({
          host: "localhost:3000",
          origin: "https://evil.example.com",
        }),
      ),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(403);
    await expect(res.response.json()).resolves.toEqual({
      error: expect.stringContaining("cross-origin"),
    });
  });

  test("a same-origin Origin is allowed", async () => {
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({ host: "localhost:3000", origin: "http://localhost:3000" }),
      ),
    );

    expect(res.status).toBe("ok");
  });

  test("an Origin on the same host but a different port is refused", async () => {
    // Same host, different origin: this is what a page served by another local
    // dev server looks like, and it is not the app.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(
        request({ host: "localhost:3000", origin: "http://localhost:5173" }),
      ),
    );

    expect(res.status).toBe("refused");
  });

  test("no Origin at all is allowed", async () => {
    // The normal case: MCP clients are not browsers and send no Origin, so the
    // check has to cost them nothing.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(request({ host: "localhost:3000" })),
    );

    expect(res.status).toBe("ok");
  });
});

describe("credentials", () => {
  test("proxy mode passes the caller's bearer token through unread", async () => {
    const res = await withEnv(httpModeEnv(), async () =>
      withNodeEnv("production", async () =>
        mcp().valMcpAuthorize(
          request({
            host: "example.com",
            authorization: "Bearer pat-from-the-caller",
          }),
        ),
      ),
    );

    // Verbatim: this app is not the authority on what the token may do, so it
    // must not normalise, truncate or interpret it on the way to the backend.
    expect(res.status === "ok" && res.ctx.auth).toEqual({
      pat: "pat-from-the-caller",
    });
  });

  test("proxy mode serves a deployed host without a loopback check", async () => {
    // The loopback requirement is specific to fs mode. In proxy mode the
    // caller's own token is the check, and the endpoint has to work on a real
    // hostname or it is useless.
    const res = await withEnv(httpModeEnv(), async () =>
      withNodeEnv("production", async () =>
        mcp().valMcpAuthorize(
          request({ host: "example.com", authorization: "Bearer pat" }),
        ),
      ),
    );

    expect(res.status).toBe("ok");
  });

  test("the bearer scheme is matched case-insensitively", async () => {
    const res = await withEnv(httpModeEnv(), async () =>
      withNodeEnv("production", async () =>
        mcp().valMcpAuthorize(
          request({ host: "example.com", authorization: "bearer pat" }),
        ),
      ),
    );

    expect(res.status === "ok" && res.ctx.auth).toEqual({ pat: "pat" });
  });

  test("a non-bearer Authorization header is not treated as a credential", async () => {
    // Reported as absent rather than passed on: the registry then refuses the
    // call in proxy mode, which is the right answer for a scheme we did not
    // agree to.
    const res = await withEnv(httpModeEnv(), async () =>
      withNodeEnv("production", async () =>
        mcp().valMcpAuthorize(
          request({ host: "example.com", authorization: "Basic dXNlcjpwdw==" }),
        ),
      ),
    );

    expect(res.status === "ok" && res.ctx.auth).toBeNull();
  });
});

describe("a call with no HTTP request", () => {
  test("is refused", async () => {
    // Reachable through a transport that carries no request. There is no
    // credential and no origin to check, which is exactly when failing open
    // would be worst.
    const res = await withNodeEnv("development", async () =>
      mcp().valMcpAuthorize(undefined),
    );

    expect(res.status).toBe("refused");
    if (res.status !== "refused") {
      return;
    }
    expect(res.response.status).toBe(401);
  });
});
