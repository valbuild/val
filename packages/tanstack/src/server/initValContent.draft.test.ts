import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { RequestScopedMemo } from "@valbuild/shared/internal";
import {
  initFetchValDraft,
  type DraftSources,
  type DraftSourcesValServer,
  type GetDraftSourcesScope,
} from "./initValContent";

/**
 * `fetchValDraft`: what a draft page is rendered with on the server, and what
 * the browser hydrates from. See `ValDraft`.
 */

const EDITED = "/content/edited.val.ts" as ModuleFilePath;
const UNTOUCHED = "/content/untouched.val.ts" as ModuleFilePath;

function fakeValServer(
  answer: Awaited<ReturnType<DraftSourcesValServer["/sources/~"]["PUT"]>>,
): { server: Promise<DraftSourcesValServer>; calls: number[] } {
  const calls: number[] = [];
  const server: DraftSourcesValServer = {
    "/sources/~": {
      PUT: async () => {
        calls.push(calls.length);
        return answer;
      },
    },
  };
  return { server: Promise.resolve(server), calls };
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
} satisfies Awaited<ReturnType<DraftSourcesValServer["/sources/~"]["PUT"]>>;

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
