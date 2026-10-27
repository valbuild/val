import { initVal, type ModuleFilePath } from "@valbuild/core";
import {
  createTanStackRequestScope,
  initFetchValStega,
  type DraftSourcesValServer,
} from "./initValContent";

/**
 * The REAL TanStack scope, driven through a stand-in for TanStack's request
 * context.
 *
 * `initValContent.sourcesMemo.test.ts` injects a hand-built box, so it proves
 * the reader memoises when handed a scope — and nothing about the scope
 * `initValContent` actually wires in. This file covers that half: the
 * `getRequest()` + `WeakMap` adapter is what draws the request boundary, and
 * it would be just as green there if it handed out one global box (one
 * author's drafts served to the next visitor) or a fresh box per call (no
 * saving at all).
 *
 * `getRequest` is modelled on what TanStack does: it returns the one `Request`
 * of the request in flight, and throws when there is none.
 */
let mockCurrentRequest: Request | null = null;
jest.mock(
  "@tanstack/react-start/server",
  () => ({
    getRequest: () => {
      if (mockCurrentRequest === null) {
        throw new Error("No request in scope");
      }
      return mockCurrentRequest;
    },
  }),
  // jest cannot resolve the real package (its `exports` map has no condition
  // jest matches: it only has `import`).
  { virtual: true },
);

async function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  mockCurrentRequest = new Request("http://localhost:3000/");
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
  scope: ReturnType<typeof createTanStackRequestScope>,
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

describe("createTanStackRequestScope", () => {
  test("reads in one request share one /sources/~ call", async () => {
    const { server, sessions } = fakeValServer();
    const fetchVal = readerFor(
      server,
      createTanStackRequestScope(),
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
      createTanStackRequestScope(),
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
      createTanStackRequestScope(),
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
      createTanStackRequestScope(),
      () => "session-alice",
    );
    const readSecond = readerFor(
      second.server,
      createTanStackRequestScope(),
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
