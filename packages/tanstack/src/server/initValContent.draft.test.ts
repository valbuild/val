import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import type { RequestScopedMemo } from "@valbuild/shared/internal";
import {
  initFetchValDraft,
  type DraftSources,
  type DraftValServer,
  type GetDraftSourcesScope,
} from "./initValContent";

/**
 * `fetchValDraft`: what a draft page is rendered with on the server, and what
 * the browser hydrates from. See `ValDraft`.
 */

const EDITED = "/content/edited.val.ts" as ModuleFilePath;
const UNTOUCHED = "/content/untouched.val.ts" as ModuleFilePath;
const KB = "/content/kb.val.ts" as ModuleFilePath;

type SourcesAnswer = Awaited<ReturnType<DraftValServer["/sources/~"]["PUT"]>>;
type JsonAnswer = Awaited<ReturnType<DraftValServer["/json"]["GET"]>>;
type PatchesAnswer = Awaited<ReturnType<DraftValServer["/patches"]["GET"]>>;

function fakeValServer(
  answer: SourcesAnswer,
  more: {
    patches?: PatchesAnswer;
    json?: (keys: string[]) => JsonAnswer;
  } = {},
): {
  server: Promise<DraftValServer>;
  calls: number[];
  jsonKeys: string[][];
} {
  const calls: number[] = [];
  const jsonKeys: string[][] = [];
  const server: DraftValServer = {
    "/sources/~": {
      PUT: async () => {
        calls.push(calls.length);
        return answer;
      },
    },
    "/patches": {
      GET: async () =>
        more.patches ?? {
          status: 200,
          json: { patches: [], baseSha: "base-sha" },
        },
    },
    "/json": {
      GET: async (req) => {
        const keys = req.query.keys ?? [];
        jsonKeys.push(keys);
        if (!more.json) {
          throw Error("this test reads no entries");
        }
        return more.json(keys);
      },
    },
  };
  return { server: Promise.resolve(server), calls, jsonKeys };
}

const draftAnswer = {
  status: 200 as const,
  json: {
    schemaSha: "schema-sha",
    sourcesSha: "sources-sha",
    modules: {
      [EDITED]: {
        source: { text: "DRAFT" },
        preview: null,
        patches: { applied: ["p1" as PatchId] },
      },
      [UNTOUCHED]: { source: { text: "published" }, preview: null },
    },
  },
} satisfies SourcesAnswer;

const cookies = (session: string | undefined) => async () => ({
  get: (name: string) =>
    session === undefined ? undefined : { name, value: session },
});

function oneRequestScope(): GetDraftSourcesScope {
  const box: RequestScopedMemo<DraftSources | null> = {};
  return async () => box;
}

test("a visitor reads nothing and gets no draft", async () => {
  const { server, calls } = fakeValServer(draftAnswer);
  const fetchValDraft = initFetchValDraft(
    server,
    async () => false,
    cookies(undefined),
    oneRequestScope(),
  );
  expect(await fetchValDraft()).toBeNull();
  expect(calls).toEqual([]);
});

test("in preview, the draft holds the modules it changes and no others", async () => {
  // An unchanged module is the build's own source, which the page already
  // has: sending it would only make every draft page heavier.
  const { server } = fakeValServer(draftAnswer);
  const fetchValDraft = initFetchValDraft(
    server,
    async () => true,
    cookies("session"),
    oneRequestScope(),
  );
  expect(await fetchValDraft()).toEqual({
    sources: { [EDITED]: { text: "DRAFT" } },
  });
});

test("it shares the request's one read with fetchVal", async () => {
  const { server, calls } = fakeValServer(draftAnswer);
  const scope = oneRequestScope();
  const fetchValDraft = initFetchValDraft(
    server,
    async () => true,
    cookies("session"),
    scope,
  );
  await fetchValDraft();
  await fetchValDraft();
  expect(calls).toHaveLength(1);
});

test("a session the server refuses is published content, not an error", async () => {
  const { server } = fakeValServer({
    status: 401,
    json: { message: "Unauthorized" },
  });
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const fetchValDraft = initFetchValDraft(
      server,
      async () => true,
      cookies("stale"),
      oneRequestScope(),
    );
    expect(await fetchValDraft()).toBeNull();
  } finally {
    warn.mockRestore();
  }
});

test("a server that fails is published content, not a page that fails", async () => {
  const { server } = fakeValServer({
    status: 500,
    json: { message: "boom", details: [] },
  });
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const fetchValDraft = initFetchValDraft(
      server,
      async () => true,
      cookies("session"),
      oneRequestScope(),
    );
    expect(await fetchValDraft()).toBeNull();
  } finally {
    error.mockRestore();
  }
});

describe("a module of `.jsonValues()` entries", () => {
  const { c } = initVal();
  /*
   * As the server reads them in-process: each entry a marker that still
   * carries its `import()`, which no serializer can send.
   */
  const kbSource = {
    "edited-entry": c.json(async () => ({ default: { title: "published" } })),
    "other-entry": c.json(async () => ({ default: { title: "other" } })),
  };
  const kbAnswer = (applied: PatchId[]): SourcesAnswer => ({
    status: 200,
    json: {
      schemaSha: "schema-sha",
      sourcesSha: "sources-sha",
      modules: {
        [KB]: { source: kbSource, preview: null, patches: { applied } },
      },
    },
  });
  const editOf = (path: string[]): PatchesAnswer => ({
    status: 200,
    json: {
      baseSha: "base-sha",
      patches: [
        {
          path: KB,
          patchId: "p1" as PatchId,
          patch: [{ op: "replace", path, value: "DRAFT" }],
          createdAt: "2026-10-04T00:00:00.000Z",
          authorId: null,
          appliedAt: null,
        },
      ],
    },
  });
  const entries = (keys: string[]): JsonAnswer => ({
    status: 200,
    json: {
      path: KB,
      entries: keys.map((key) => ({ key, content: { title: "DRAFT" } })),
      missing: [],
      errors: [],
    },
  });

  test("the draft has the content of the entries it edits, and markers for the rest", async () => {
    const { server, jsonKeys } = fakeValServer(kbAnswer(["p1" as PatchId]), {
      patches: editOf(["edited-entry", "title"]),
      json: entries,
    });
    const fetchValDraft = initFetchValDraft(
      server,
      async () => true,
      cookies("session"),
      oneRequestScope(),
    );
    const draft = await fetchValDraft();
    expect(jsonKeys).toEqual([["edited-entry"]]);
    expect(draft).toEqual({
      sources: {
        [KB]: {
          "edited-entry": { title: "DRAFT" },
          // The wire shape: what the Studio gets over HTTP, thunk and all gone.
          "other-entry": { _type: "json" },
        },
      },
    });
    // Sent from the server to the page, so it has to survive the trip.
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });

  test("an entry that cannot be read leaves the module out, rather than published in a draft", async () => {
    const { server } = fakeValServer(kbAnswer(["p1" as PatchId]), {
      patches: editOf(["edited-entry", "title"]),
      json: (keys) => ({
        status: 200,
        json: {
          path: KB,
          entries: [],
          missing: [],
          errors: keys.map((key) => ({ key, message: "unreadable" })),
        },
      }),
    });
    const fetchValDraft = initFetchValDraft(
      server,
      async () => true,
      cookies("session"),
      oneRequestScope(),
    );
    expect(await fetchValDraft()).toEqual({ sources: {} });
  });

  test("a write of the whole record leaves the module out", async () => {
    const { server, jsonKeys } = fakeValServer(kbAnswer(["p1" as PatchId]), {
      patches: editOf([]),
      json: entries,
    });
    const fetchValDraft = initFetchValDraft(
      server,
      async () => true,
      cookies("session"),
      oneRequestScope(),
    );
    expect(await fetchValDraft()).toEqual({ sources: {} });
    expect(jsonKeys).toEqual([]);
  });
});

describe("at a proposal's address", () => {
  // The proposal's saved Source: the third source provider. See `ValDraft`.
  const snapshot = { [UNTOUCHED]: { text: "saved in the proposal" } };

  test("a reviewer who is not editing still gets the proposal, and no draft", async () => {
    const { server, calls } = fakeValServer(draftAnswer);
    const fetchValDraft = initFetchValDraft(
      server,
      async () => false,
      cookies(undefined),
      oneRequestScope(),
      snapshot,
    );
    expect(await fetchValDraft()).toEqual({
      sources: {},
      snapshot,
      draftMode: false,
    });
    expect(calls).toEqual([]);
  });

  test("an editor gets the draft over it, and the snapshot beside it", async () => {
    const { server } = fakeValServer(draftAnswer);
    const fetchValDraft = initFetchValDraft(
      server,
      async () => true,
      cookies("session"),
      oneRequestScope(),
      snapshot,
    );
    expect(await fetchValDraft()).toEqual({
      sources: { [EDITED]: { text: "DRAFT" } },
      snapshot,
    });
  });

  test("a draft that cannot be read still leaves the proposal on the page", async () => {
    const { server } = fakeValServer({
      status: 401,
      json: { message: "Unauthorized" },
    });
    const fetchValDraft = initFetchValDraft(
      server,
      async () => true,
      cookies("expired"),
      oneRequestScope(),
      snapshot,
    );
    expect(await fetchValDraft()).toEqual({
      sources: {},
      snapshot,
      draftMode: false,
    });
  });
});
