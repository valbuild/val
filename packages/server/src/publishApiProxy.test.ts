import { ValOpsHttp } from "./ValOpsHttp";

/**
 * Publishing through the deployment, because the browser cannot do it itself.
 *
 * The Studio builds a managed project in its own tab and then has to publish
 * what it built. It holds a session cookie for the app's origin and no
 * credential content would accept -- content's publish API takes a PROJECT
 * TOKEN and refuses everything else, deliberately. What this deployment has is
 * the project's api key, which is not one.
 *
 * So the api key is exchanged for a publish-scoped token that lasts ten
 * minutes, and only that travels. These pin the parts of that exchange whose
 * failure is either silent or expensive: what may be reached, what is cached,
 * and what happens when the token stops working mid-publish.
 */

type Call = { url: string; method: string; authorization: string | null };

function opsWith(
  answer: (
    call: Call,
    n: number,
  ) => {
    ok?: boolean;
    status: number;
    body: string;
  },
) {
  const calls: Call[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call = {
      url: String(url),
      method: init?.method ?? "GET",
      authorization: headers["Authorization"] ?? null,
    };
    calls.push(call);
    const res = answer(call, calls.length);
    return {
      ok: res.ok ?? res.status < 400,
      status: res.status,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => res.body,
    };
  }) as unknown as typeof fetch;
  const ops = new ValOpsHttp(
    "https://content.val.build",
    "acme/site",
    { commit: "commit-sha", branch: "main" },
    { apiKey: "the-api-key" },
    // Nothing on this path evaluates a module or reads a schema.
    { modules: [] } as never,
  );
  return { ops, calls, restore: () => (global.fetch = originalFetch) };
}

/** A token that is good for ten minutes, as content mints them. */
const freshToken = (token = "publish-token") =>
  JSON.stringify({
    token,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    publicProjectId: "p",
    productionUrl: null,
  });

describe("what may be reached", () => {
  test("the publish conversation and the build target, and nothing else", async () => {
    const allowed = [
      "/build-target",
      "/publish",
      "/publish/pub_1",
      "/publish/pub_1/artifacts",
      "/publish/pub_1/verify",
      "/publish/pub_1/promote",
    ];
    for (const path of allowed) {
      const { ops, restore } = opsWith((call) => ({
        status: 200,
        body: call.url.endsWith("/publish-token") ? freshToken() : "{}",
      }));
      try {
        expect((await ops.publishApi(path, { method: "GET" })).status).toBe(
          200,
        );
      } finally {
        restore();
      }
    }
  });

  test("anything else is refused before a credential is minted", async () => {
    /*
     * The browser chooses this path, and this method holds the project's
     * credential. A refusal that happened after the exchange would still be a
     * refusal -- and would still have minted a token for a caller asking for
     * something it may not have.
     */
    const refused = [
      "/patches",
      "/publish/../patches",
      "/publish/pub_1/artifacts/extra",
      "/build-target?x=1",
      "/publish-token",
      "",
    ];
    for (const path of refused) {
      const { ops, calls, restore } = opsWith(() => ({
        status: 200,
        body: "{}",
      }));
      try {
        expect((await ops.publishApi(path, { method: "GET" })).status).toBe(
          403,
        );
        expect(calls).toEqual([]);
      } finally {
        restore();
      }
    }
  });
});

describe("the credential", () => {
  test("the api key is exchanged, and never forwarded", async () => {
    const { ops, calls, restore } = opsWith((call) => ({
      status: 200,
      body: call.url.endsWith("/publish-token") ? freshToken() : "{}",
    }));
    try {
      await ops.publishApi("/publish", { method: "POST", body: "{}" });
      const [exchange, publish] = calls;
      expect(exchange?.url).toBe(
        "https://content.val.build/v1/acme/site/publish-token",
      );
      expect(exchange?.authorization).toBe("Bearer the-api-key");
      // The one that matters: what reaches the publish API is the narrow,
      // ten-minute token, not the project's key.
      expect(publish?.url).toBe("https://content.val.build/v1/publish");
      expect(publish?.authorization).toBe("Bearer publish-token");
    } finally {
      restore();
    }
  });

  test("is minted once for a whole publish, not once per step", async () => {
    // A publish is five calls plus an upload of every artifact. Exchanging per
    // step would be five round trips for one answer that does not change.
    const { ops, calls, restore } = opsWith((call) => ({
      status: 200,
      body: call.url.endsWith("/publish-token") ? freshToken() : "{}",
    }));
    try {
      await ops.publishApi("/publish", { method: "POST", body: "{}" });
      await ops.publishApi("/publish/pub_1/artifacts", { method: "POST" });
      await ops.publishApi("/publish/pub_1/promote", { method: "POST" });
      expect(
        calls.filter((c) => c.url.endsWith("/publish-token")),
      ).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("a token that expires sooner than it said is replaced, once", async () => {
    /*
     * Revoked, or the clock disagreed. One retry, because the alternative is a
     * publish that fails for a reason the editor cannot act on and a retry that
     * fails the same way -- and the artifacts have already been uploaded by
     * then.
     */
    let issued = 0;
    const { ops, calls, restore } = opsWith((call) => {
      if (call.url.endsWith("/publish-token")) {
        issued += 1;
        return { status: 200, body: freshToken(`token-${issued}`) };
      }
      return call.authorization === "Bearer token-1"
        ? { status: 401, body: '{"message":"revoked"}' }
        : { status: 200, body: '{"publishId":"pub_1"}' };
    });
    try {
      const res = await ops.publishApi("/publish", { method: "POST" });
      expect(res.status).toBe(200);
      expect(calls.map((c) => c.authorization)).toEqual([
        "Bearer the-api-key",
        "Bearer token-1",
        "Bearer the-api-key",
        "Bearer token-2",
      ]);
    } finally {
      restore();
    }
  });

  test("a token with no readable expiry is used but not kept", async () => {
    // Caching one we cannot reason about is how a publish starts failing
    // halfway through, days later, for no reason anyone can see.
    const { ops, calls, restore } = opsWith((call) => ({
      status: 200,
      body: call.url.endsWith("/publish-token")
        ? JSON.stringify({ token: "t", expiresAt: null })
        : "{}",
    }));
    try {
      await ops.publishApi("/publish", { method: "POST" });
      await ops.publishApi("/publish/pub_1/verify", { method: "POST" });
      expect(
        calls.filter((c) => c.url.endsWith("/publish-token")),
      ).toHaveLength(2);
    } finally {
      restore();
    }
  });

  test("an exchange that fails is reported, and nothing is published", async () => {
    const { ops, calls, restore } = opsWith(() => ({
      status: 403,
      body: '{"message":"no publish scope"}',
    }));
    try {
      const res = await ops.publishApi("/publish", { method: "POST" });
      expect(res.status).toBe(403);
      expect(res.body).toContain("Could not get a publish token");
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("what comes back", () => {
  test("content's status is carried through, not flattened", async () => {
    // A publish that is already live answers 409, and the Studio has to be able
    // to tell that from a failure.
    const { ops, restore } = opsWith((call) => ({
      status: call.url.endsWith("/publish-token") ? 200 : 409,
      body: call.url.endsWith("/publish-token")
        ? freshToken()
        : '{"message":"already live"}',
    }));
    try {
      const res = await ops.publishApi("/publish", { method: "POST" });
      expect(res.status).toBe(409);
      expect(res.body).toBe('{"message":"already live"}');
    } finally {
      restore();
    }
  });
});

describe("a deployment with no content service", () => {
  test("says so rather than pretending to publish", async () => {
    const { ValOpsFS } = await import("./ValOpsFS");
    /*
     * The prototype, not an instance: constructing one wants a working tree,
     * and the answer under test is the base class's and depends on nothing.
     */
    const ops: InstanceType<typeof ValOpsFS> = Object.create(
      ValOpsFS.prototype,
    );
    const res = await ops.publishApi("/publish", { method: "POST" });
    expect(res.status).toBe(501);
    expect(res.body).toContain("no content service");
  });
});
