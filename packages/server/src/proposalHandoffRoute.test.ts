import crypto from "crypto";
import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";
import { HANDOFF_KEY_CONTEXT } from "./proposalHandoff";

/**
 * `/proposal-handoff`: this session, sealed for one proposal's address, read
 * from content. Driven over the route, against a content service faked at
 * `fetch`.
 */

const VAL_SECRET = "test-secret-at-least-32-chars-long!!";
const CONTENT = "https://content.test";
const NAME = "0123456789abcdef0123";
const ADDRESS = `https://${NAME}--site.valstart.dev`;

function setup(proposal: { status: number; body: unknown }) {
  const { c, s, config } = initVal({ project: "acme/site" });
  const route = "/api/val";
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const status =
      path.endsWith(`/proposals/${NAME}`) && (init?.method ?? "GET") === "GET"
        ? proposal.status
        : 404;
    const body = status === 404 ? { message: "not found" } : proposal.body;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
  const handler = createValApiRouter(
    route,
    createValServer(
      modules(config, [
        {
          def: () =>
            Promise.resolve({
              default: c.define("/content/page.val.ts", s.string(), "Built"),
            }),
        },
      ]),
      route,
      {
        mode: "proxy",
        apiKey: "test-api-key",
        valSecret: VAL_SECRET,
        valContentUrl: CONTENT,
        project: "acme/site",
        disableCache: true,
        versions: { core: "1.0.0", next: "1.0.0" },
      },
      config,
      {
        async isEnabled() {
          return true;
        },
        async onDisable() {},
        async onEnable() {},
      },
    ),
    (res) => res,
  );
  return {
    handler,
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}

const session = encodeJwt(
  {
    sub: "author-1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    token: "content-api-token",
    org: "acme",
    project: "acme/site",
  },
  VAL_SECRET,
);

const request = (cookie: string | null) =>
  fakeRequest({
    method: "POST",
    url: new URL("http://localhost/api/val/proposal-handoff"),
    headers: new Headers(cookie === null ? {} : { Cookie: cookie }),
    json: { proposal: NAME },
  });

function open(token: string): unknown {
  const bytes = Buffer.from(token, "base64url");
  const key = crypto
    .createHash("sha256")
    .update(HANDOFF_KEY_CONTEXT + VAL_SECRET)
    .digest();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(12, bytes.length - 16)),
      decipher.final(),
    ]).toString("utf8"),
  );
}

describe("/proposal-handoff", () => {
  test("seals this session for the proposal's address, read from content", async () => {
    const { handler, restore } = setup({
      status: 200,
      body: { proposal: { name: NAME, address: ADDRESS } },
    });
    try {
      const res = await handler(
        request(`val_session=${encodeURIComponent(session)}`),
      );
      expect(res.status).toBe(200);
      const json = res.json as { action: string; token: string };
      expect(json.action).toBe(`${ADDRESS}/__val/handoff`);
      const handoff = open(json.token) as Record<string, unknown>;
      expect(handoff).toMatchObject({ v: 1, aud: ADDRESS, session });
      const now = Math.floor(Date.now() / 1000);
      expect(handoff.exp).toBeGreaterThan(now);
      expect(handoff.exp).toBeLessThanOrEqual(now + 60);
    } finally {
      restore();
    }
  });

  test("hands nobody's session over: signed out is a 401", async () => {
    const { handler, restore } = setup({
      status: 200,
      body: { proposal: { name: NAME, address: ADDRESS } },
    });
    try {
      expect((await handler(request(null))).status).toBe(401);
    } finally {
      restore();
    }
  });

  test("a proposal content does not know is a 404", async () => {
    const { handler, restore } = setup({ status: 404, body: {} });
    try {
      const res = await handler(
        request(`val_session=${encodeURIComponent(session)}`),
      );
      expect(res.status).toBe(404);
    } finally {
      restore();
    }
  });

  test("a proposal still being set up has no address to seal for", async () => {
    const { handler, restore } = setup({
      status: 200,
      body: { proposal: { name: NAME, address: null } },
    });
    try {
      const res = await handler(
        request(`val_session=${encodeURIComponent(session)}`),
      );
      expect(res.status).toBe(409);
    } finally {
      restore();
    }
  });
});
