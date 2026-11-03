import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import type { RequestScopedMemo } from "@valbuild/shared/internal";
import type { ComponentProps } from "react";
import type { ValNextProvider } from "../ValNextProvider";
import {
  initFetchValDraft,
  type DraftSources,
  type DraftSourcesValServer,
  type GetDraftSourcesScope,
} from "./initValRsc";

/**
 * `fetchValDraft` from `initValRsc`: what `<ValProvider draft>` is given, so a
 * draft page is rendered as the draft on the server and hydrated from the
 * same thing. The read is `readDraftChanges` in `@valbuild/server`, which
 * `@valbuild/tanstack/server`'s `fetchValDraft` is too; these pin that Next's
 * answers what TanStack's does (`initValContent.draft.test.ts`), from Next's
 * request context.
 */

const EDITED = "/app/edited/page.val.ts" as ModuleFilePath;
const UNTOUCHED = "/app/untouched/page.val.ts" as ModuleFilePath;
const KB = "/app/kb/page.val.ts" as ModuleFilePath;

type SourcesAnswer = Awaited<
  ReturnType<DraftSourcesValServer["/sources/~"]["PUT"]>
>;
type JsonAnswer = Awaited<ReturnType<DraftSourcesValServer["/json"]["GET"]>>;
type PatchesAnswer = Awaited<
  ReturnType<DraftSourcesValServer["/patches"]["GET"]>
>;

function fakeValServer(
  answer: SourcesAnswer,
  more: {
    patches?: PatchesAnswer;
    json?: (keys: string[]) => JsonAnswer;
  } = {},
): {
  server: Promise<DraftSourcesValServer>;
  calls: number[];
  jsonKeys: string[][];
} {
  const calls: number[] = [];
  const jsonKeys: string[][] = [];
  const server: DraftSourcesValServer = {
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

/** What `cookies()` from `next/headers` answers, as far as Val reads it. */
const cookies = (session: string | undefined) => async () => ({
  get: (name: string) =>
    session === undefined ? undefined : { name, value: session },
});

/** One request's `cache()` box, as `createReactCacheScope` hands it out. */
function oneRequestScope(): GetDraftSourcesScope {
  const box: RequestScopedMemo<DraftSources | null> = {};
  return async () => box;
}

test("outside draft mode it reads nothing and gives no draft", async () => {
  const { server, calls } = fakeValServer(draftAnswer);
  const readCookies = jest.fn(cookies(undefined));
  const fetchValDraft = initFetchValDraft(
    server,
    async () => false,
    readCookies,
    oneRequestScope(),
  );
  expect(await fetchValDraft()).toBeNull();
  // `cookies()` makes a Next route dynamic: a visitor's request never asks.
  expect(readCookies).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

test("in draft mode, the draft holds the modules it changes and no others", async () => {
  const { server } = fakeValServer(draftAnswer);
  const fetchValDraft = initFetchValDraft(
    server,
    async () => true,
    cookies("session"),
    oneRequestScope(),
  );
  const draft = await fetchValDraft();
  expect(draft).toEqual({ sources: { [EDITED]: { text: "DRAFT" } } });
  // What `ValProvider` takes, as it is: no conversion between the two.
  const prop: ComponentProps<typeof ValNextProvider>["draft"] = draft;
  expect(prop).toBe(draft);
  // Passed from a Server Component to a Client one, so it has to survive
  // the trip.
  expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
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

test("a session the server refuses is the published page, not an error", async () => {
  const { server } = fakeValServer({
    status: 401,
    json: { message: "Unauthorized" },
  });
  const fetchValDraft = initFetchValDraft(
    server,
    async () => true,
    cookies("stale"),
    oneRequestScope(),
  );
  expect(await fetchValDraft()).toBeNull();
});

test("a server that fails is the published page, not a page that fails", async () => {
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

test("outside a request (draftMode() throws) it is the published page", async () => {
  const { server, calls } = fakeValServer(draftAnswer);
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const fetchValDraft = initFetchValDraft(
      server,
      async () => {
        throw new Error("`draftMode` was called outside a request scope.");
      },
      cookies("session"),
      oneRequestScope(),
    );
    expect(await fetchValDraft()).toBeNull();
    expect(calls).toEqual([]);
  } finally {
    error.mockRestore();
  }
});

test("a `.jsonValues()` module has the entries the draft edits, and markers for the rest", async () => {
  const { c } = initVal();
  const kbSource = {
    "edited-entry": c.json(async () => ({ default: { title: "published" } })),
    "other-entry": c.json(async () => ({ default: { title: "other" } })),
  };
  const { server, jsonKeys } = fakeValServer(
    {
      status: 200,
      json: {
        schemaSha: "schema-sha",
        sourcesSha: "sources-sha",
        modules: {
          [KB]: {
            source: kbSource,
            preview: null,
            patches: { applied: ["p1" as PatchId] },
          },
        },
      },
    },
    {
      patches: {
        status: 200,
        json: {
          baseSha: "base-sha",
          patches: [
            {
              path: KB,
              patchId: "p1" as PatchId,
              patch: [
                {
                  op: "replace",
                  path: ["edited-entry", "title"],
                  value: "DRAFT",
                },
              ],
              createdAt: "2026-10-04T00:00:00.000Z",
              authorId: null,
              appliedAt: null,
            },
          ],
        },
      },
      json: (keys) => ({
        status: 200,
        json: {
          path: KB,
          entries: keys.map((key) => ({ key, content: { title: "DRAFT" } })),
          missing: [],
          errors: [],
        },
      }),
    },
  );
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
        "other-entry": { _type: "json" },
      },
    },
  });
});
