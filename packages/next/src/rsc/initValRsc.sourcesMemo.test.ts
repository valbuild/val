import { initVal, type ModuleFilePath } from "@valbuild/core";
import { raw } from "@valbuild/react/stega";
import type { RequestScopedMemo } from "@valbuild/shared/internal";
import {
  initFetchValStega,
  type DraftSources,
  type DraftSourcesValServer,
  type GetDraftSourcesScope,
} from "./initValRsc";

const { s, c } = initVal();

const GREETING = "/content/greeting.val.ts" as ModuleFilePath;
const FAREWELL = "/content/farewell.val.ts" as ModuleFilePath;

const greeting = c.define(GREETING, s.object({ text: s.string() }), {
  text: "published hello",
});
const farewell = c.define(FAREWELL, s.object({ text: s.string() }), {
  text: "published bye",
});

type SourcesCall = {
  path: string | undefined;
  query: Record<string, unknown>;
  session: string | undefined;
};

/**
 * A server with only the route the draft reader uses, recording what it was
 * asked for.
 *
 * The assertions below are about the REQUESTS, not the answers: the whole
 * change is that a page which reads three times asks once, and nothing about
 * the returned content would show that.
 */
function fakeValServer(): {
  server: Promise<DraftSourcesValServer>;
  calls: SourcesCall[];
} {
  const calls: SourcesCall[] = [];
  const server: DraftSourcesValServer = {
    "/sources/~": {
      PUT: async (req) => {
        calls.push({
          path: req.path,
          query: { ...req.query },
          session: req.cookies["val_session"],
        });
        return {
          status: 200,
          json: {
            schemaSha: "schema-sha",
            sourcesSha: "sources-sha",
            modules: {
              [GREETING]: {
                source: { text: "DRAFT hello" },
                preview: null,
              },
              [FAREWELL]: {
                source: { text: "DRAFT bye" },
                preview: null,
              },
            },
          },
        };
      },
    },
  };
  return { server: Promise.resolve(server), calls };
}

const headers = async () => ({
  get: (name: string) => (name === "host" ? "localhost:3000" : null),
});

const cookiesFor = (session: string) => async () => ({
  get: (name: string) => ({ name, value: session }),
});

/** One request's worth of scope: the same box handed to every read in it. */
function oneRequestScope(): GetDraftSourcesScope {
  const box: RequestScopedMemo<DraftSources | null> = {};
  return async () => box;
}

function readerFor(
  server: Promise<DraftSourcesValServer>,
  scope: GetDraftSourcesScope,
  session = "session-alice",
) {
  return initFetchValStega(
    { project: "test" },
    "/api/val",
    server,
    async () => true,
    headers,
    cookiesFor(session),
    scope,
  );
}

function textOf(val: unknown): string | undefined {
  if (!val || typeof val !== "object") {
    return undefined;
  }
  const text = (val as { text?: unknown }).text;
  return typeof text === "string" ? raw(text) : undefined;
}

describe("fetchVal draft sources are read once per request", () => {
  test("three reads in one request make ONE /sources/~ call", async () => {
    const { server, calls } = fakeValServer();
    const fetchVal = readerFor(server, oneRequestScope());

    const [a, b, cc] = [
      await fetchVal(greeting),
      await fetchVal(farewell),
      await fetchVal(greeting),
    ];

    expect(textOf(a)).toBe("DRAFT hello");
    expect(textOf(b)).toBe("DRAFT bye");
    expect(textOf(cc)).toBe("DRAFT hello");
    expect(calls).toHaveLength(1);
  });

  test("concurrent reads in one request also make ONE call", async () => {
    // A page renders its sections in parallel, so the second read starts before
    // the first has resolved. Memoising the resolved value would miss this.
    const { server, calls } = fakeValServer();
    const fetchVal = readerFor(server, oneRequestScope());

    const results = await Promise.all([
      fetchVal(greeting),
      fetchVal(farewell),
      fetchVal(greeting),
    ]);

    expect(results.map(textOf)).toStrictEqual([
      "DRAFT hello",
      "DRAFT bye",
      "DRAFT hello",
    ]);
    expect(calls).toHaveLength(1);
  });

  test("a SECOND request reads again — the memo never outlives one", async () => {
    // The memoised body carries the caller's own unpublished patches
    // (`own_patch_groups_only`), so a memo shared between requests would show
    // one author's staged edit to the next visitor.
    const { server, calls } = fakeValServer();

    await readerFor(server, oneRequestScope(), "session-alice")(greeting);
    await readerFor(server, oneRequestScope(), "session-bob")(greeting);

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.session)).toStrictEqual([
      "session-alice",
      "session-bob",
    ]);
  });

  test("no request scope falls back to reading every time", async () => {
    // Outside a request there is nothing to scope to. Ineffective is the safe
    // failure; sharing would not be.
    const { server, calls } = fakeValServer();
    const noScope: GetDraftSourcesScope = async () => null;
    const fetchVal = readerFor(server, noScope);

    await fetchVal(greeting);
    await fetchVal(farewell);

    expect(calls).toHaveLength(2);
  });

  test("the one call keeps the draft query semantics", async () => {
    // Each of these was decided for a reason recorded beside it in the reader;
    // `own_patch_groups_only` in particular is what keeps one author's
    // unpublished work out of another's preview.
    const { server, calls } = fakeValServer();
    await readerFor(server, oneRequestScope())(greeting);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/");
    expect(calls[0].query).toStrictEqual({
      validate_sources: true,
      validate_binary_files: false,
      exclude_patches: false,
      apply_patches: undefined,
      patch_id: undefined,
      own_patch_groups_only: true,
    });
    expect(calls[0].session).toBe("session-alice");
  });
});
