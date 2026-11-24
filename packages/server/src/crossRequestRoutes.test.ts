import { AsyncLocalStorage } from "node:async_hooks";
import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import type { ValServer } from "./ValServer";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

/**
 * Val's API on workerd, where one isolate serves many requests and a promise
 * belongs to the request that made it: awaiting one made by a request that
 * has since ended fails at once, with nothing asked of anyone. On Val's
 * hosting `/stat`, `/patches` and `/admin/proxy/...` answered 503 in 1-4 ms
 * of isolate time -- too fast for a request to the content service to have
 * been made at all.
 *
 * The API is made once per isolate, by whichever request first loads the
 * route module, so its server is a promise of THAT request; and `/stat` read
 * any throw from its call to the content service as "could not be reached".
 *
 * Driven through the real router in http mode. Faked: the request context
 * (async local storage, as TanStack reads it), workerd's rule for a promise of
 * an ended request ({@link RequestBoundPromise}), and the content service
 * (`fetch`).
 */

const CROSS_REQUEST =
  "This promise was created by a request that has since ended, so it can never settle.";

type FakeRequest = { ended: boolean };
const requests = new AsyncLocalStorage<FakeRequest>();

/** Run `work` as a request of the isolate; `end()` ends it. */
function request<T>(work: () => T) {
  const req: FakeRequest = { ended: false };
  return {
    result: requests.run(req, work),
    end() {
      req.ended = true;
    },
  };
}

/**
 * A promise as workerd has it: the request that made it owns it, and another
 * request awaiting it once that one has ended is refused.
 */
class RequestBoundPromise<T> extends Promise<T> {
  readonly owner = requests.getStore();

  override then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    const caller = requests.getStore();
    if (this.owner !== undefined && caller !== this.owner && this.owner.ended) {
      return Promise.reject(new Error(CROSS_REQUEST)).then(
        onFulfilled,
        onRejected,
      );
    }
    return super.then(onFulfilled, onRejected);
  }
}

const route = "/api/val";
const { c, s, config } = initVal({});

/** The API, made as a route module makes it -- in the current request. */
function makeApi() {
  const server = createValServer(
    modules(config, [
      {
        def: () =>
          Promise.resolve({
            default: c.define("/content/page.val.ts", s.string(), "hello"),
          }),
      },
    ]),
    route,
    {
      ...config,
      disableCache: true,
      apiKey: "test-api-key",
      valSecret: "test-secret",
      project: "test-org/test-project",
      valContentUrl: "http://localhost:9999",
      versions: { core: "0.0.0-test", next: "0.0.0-test" },
    },
    config,
    {
      async isEnabled() {
        return true;
      },
      async onDisable() {},
      async onEnable() {},
    },
  );
  return createValApiRouter(
    route,
    new RequestBoundPromise<ValServer>((resolve, reject) =>
      server.then(resolve, reject),
    ),
    (res) => res,
  );
}

const SESSION = {
  sub: "ada",
  exp: Math.floor(Date.now() / 1000) + 3600,
  token: "test-token",
  org: "test-org",
  project: "test-project",
};

const stat = (api: ReturnType<typeof makeApi>) =>
  api(
    fakeRequest({
      method: "POST",
      url: new URL(`http://localhost:3000${route}/stat`),
      headers: new Headers({
        Cookie: `val_session=${encodeJwt(SESSION, "test-secret")}`,
      }),
      json: null,
    }),
  );

/**
 * The content service, with `refuse` deciding which calls to the patches
 * workerd refuses as another request's.
 */
function contentService(refuse: (call: number) => boolean) {
  let patchCalls = 0;
  const content: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith("/applicable/patches")) {
      if (refuse(patchCalls++)) throw new Error(CROSS_REQUEST);
      return Response.json({ patches: [] });
    }
    if (url.pathname.endsWith("/websocket/nonces")) {
      return Response.json({ nonce: "nonce", url: "wss://content/socket" });
    }
    return Response.json({ message: "not here" }, { status: 500 });
  };
  global.fetch = content;
}

const previousEnv = {
  commit: process.env["VAL_GIT_COMMIT"],
  branch: process.env["VAL_GIT_BRANCH"],
};
beforeAll(() => {
  process.env["VAL_GIT_COMMIT"] = "0000000000000000000000000000000000000000";
  process.env["VAL_GIT_BRANCH"] = "main";
});
afterAll(() => {
  if (previousEnv.commit === undefined) delete process.env["VAL_GIT_COMMIT"];
  else process.env["VAL_GIT_COMMIT"] = previousEnv.commit;
  if (previousEnv.branch === undefined) delete process.env["VAL_GIT_BRANCH"];
  else process.env["VAL_GIT_BRANCH"] = previousEnv.branch;
});
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test("/stat answers from an API made by a request that has since ended", async () => {
  contentService(() => false);
  // The first request loads the route module, which makes the API...
  const first = request(() => makeApi());
  const api = first.result;
  // ...and is answered, and ends.
  await new Promise((resolve) => setTimeout(resolve, 0));
  first.end();
  const next = request(() => stat(api));
  const res = await next.result;
  expect(res.status).toBe(200);
});

test("/stat asks again when its read of the patches is refused as another request's", async () => {
  contentService((call) => call === 0);
  const api = makeApi();
  const res = await stat(api);
  expect(res.status).toBe(200);
});

test("/stat refused every time is Val's failure, never the service's unreachability", async () => {
  contentService(() => true);
  const api = makeApi();
  const res = await stat(api);
  expect(res.status).toBe(500);
  expect(JSON.stringify("json" in res ? res.json : null)).not.toMatch(/reach/i);
});
