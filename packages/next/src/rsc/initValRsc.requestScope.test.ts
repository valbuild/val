import { initVal, type ModuleFilePath } from "@valbuild/core";
import {
  createReactCacheScope,
  initFetchValStega,
  type DraftSourcesValServer,
} from "./initValRsc";

/**
 * The REAL Next scope, driven through a stand-in for React's request cache.
 *
 * `initValRsc.sourcesMemo.test.ts` injects a hand-built box, so it proves the
 * reader memoises when handed a scope, and nothing about the scope
 * `initValRsc` actually wires in. This file covers that half: the `cache()`
 * adapter is what draws the request boundary, and it would be just as green
 * there if it handed out one global box (one author's drafts served to the
 * next visitor) or a fresh box per call (no saving at all).
 *
 * `cache` is replaced because jest loads React's non-`react-server` build,
 * where it is a pass-through. The stand-in has the semantics React documents
 * for an RSC render: one result per wrapped function per request, a fresh one
 * for the next request, and a pass-through outside a render.
 */
let mockCurrentRequest: object | null = null;
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  cache: <T>(fn: () => T) => {
    const perRequest = new WeakMap<object, { value: T }>();
    return (): T => {
      if (mockCurrentRequest === null) {
        return fn();
      }
      const cached = perRequest.get(mockCurrentRequest);
      if (cached) {
        return cached.value;
      }
      const value = fn();
      perRequest.set(mockCurrentRequest, { value });
      return value;
    };
  },
}));

async function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  mockCurrentRequest = {};
  try {
    return await fn();
  } finally {
    mockCurrentRequest = null;
  }
}

const { s, c } = initVal();

const GREETING = "/content/greeting.val.ts" as ModuleFilePath;
const greeting = c.define(GREETING, s.object({ text: s.string() }), {
  text: "published hello",
});

function fakeValServer(): {
  server: Promise<DraftSourcesValServer>;
  sessions: (string | undefined)[];
} {
  const sessions: (string | undefined)[] = [];
  const server: DraftSourcesValServer = {
    "/sources/~": {
      PUT: async (req) => {
        sessions.push(req.cookies["val_session"]);
        return {
          status: 200,
          json: {
            schemaSha: "schema-sha",
            sourcesSha: "sources-sha",
            modules: {
              [GREETING]: { source: { text: "DRAFT hello" }, preview: null },
            },
          },
        };
      },
    },
  };
  return { server: Promise.resolve(server), sessions };
}

function readerFor(
  server: Promise<DraftSourcesValServer>,
  scope: ReturnType<typeof createReactCacheScope>,
  session: () => string,
) {
  return initFetchValStega(
    { project: "test" },
    "/api/val",
    server,
    async () => true,
    async () => ({
      get: (name: string) => (name === "host" ? "localhost:3000" : null),
    }),
    async () => ({
      get: (name: string) => ({ name, value: session() }),
    }),
    scope,
  );
}

describe("createReactCacheScope", () => {
  test("reads in one request share one /sources/~ call", async () => {
    const { server, sessions } = fakeValServer();
    const fetchVal = readerFor(
      server,
      createReactCacheScope(),
      () => "session-alice",
    );

    await inRequest(async () => {
      await fetchVal(greeting);
      await Promise.all([fetchVal(greeting), fetchVal(greeting)]);
    });

    expect(sessions).toStrictEqual(["session-alice"]);
  });

  test("a second request reads again, even for the same session", async () => {
    // Same session on purpose: the session key would make a different author
    // miss anyway, so only this shows the box itself ends with the request.
    const { server, sessions } = fakeValServer();
    const fetchVal = readerFor(
      server,
      createReactCacheScope(),
      () => "session-alice",
    );

    await inRequest(async () => {
      await fetchVal(greeting);
      await fetchVal(greeting);
    });
    await inRequest(async () => {
      await fetchVal(greeting);
      await fetchVal(greeting);
    });

    expect(sessions).toStrictEqual(["session-alice", "session-alice"]);
  });

  test("outside a request it reads every time rather than sharing", async () => {
    const { server, sessions } = fakeValServer();
    const fetchVal = readerFor(
      server,
      createReactCacheScope(),
      () => "session-alice",
    );

    await fetchVal(greeting);
    await fetchVal(greeting);

    expect(sessions).toHaveLength(2);
  });

  test("two scopes never share a box within one request", async () => {
    // One per `initValContent`: two Val servers in one process hold different
    // content, so one must not answer the other's reads.
    const first = fakeValServer();
    const second = fakeValServer();
    const readFirst = readerFor(
      first.server,
      createReactCacheScope(),
      () => "session-alice",
    );
    const readSecond = readerFor(
      second.server,
      createReactCacheScope(),
      () => "session-alice",
    );

    await inRequest(async () => {
      await readFirst(greeting);
      await readSecond(greeting);
    });

    expect(first.sessions).toHaveLength(1);
    expect(second.sessions).toHaveLength(1);
  });
});
