import { initVal, type ModuleFilePath } from "@valbuild/core";
import { raw } from "@valbuild/react/stega";
import {
  initFetchValKeyStega,
  resolveDraftOrCommittedEntry,
  type DraftJsonEntry,
  type JsonEntryValServer,
} from "./initValRsc";

const { s, c } = initVal();

const PAGES = "/pages.val.ts" as ModuleFilePath;

/**
 * A `.jsonValues()` module whose entries resolve through their local thunks —
 * i.e. the COMMITTED content, which is what production reads.
 */
const pagesVal = c.define(
  PAGES,
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "/a": c.json(() => Promise.resolve({ default: { title: "committed A" } })),
  },
);

type JsonResponse =
  | {
      status: 200;
      json: { path: ModuleFilePath; key: string; content: unknown };
    }
  | { status: 404 | 401 | 500; json: { message: string } };

/**
 * A server with only the route these readers use — which is all the readers ask
 * for (`JsonEntryValServer`), so no cast is needed. Driving the real reader
 * against a controllable `/json` is what verifies the draft/committed decision
 * end to end; building an actual ValServer would need a project on disk.
 */
function fakeValServer(respond: (key: string) => JsonResponse): {
  server: Promise<JsonEntryValServer>;
  calls: { key: string | undefined; applyPatches: unknown }[];
} {
  const calls: { key: string | undefined; applyPatches: unknown }[] = [];
  const server: JsonEntryValServer = {
    "/json": {
      GET: async (req) => {
        calls.push({
          key: req.query.key,
          applyPatches: req.query.apply_patches,
        });
        return respond(req.query.key as string);
      },
    },
  };
  return { server: Promise.resolve(server), calls };
}

const cookies = async () => ({
  get: (name: string) => ({ name, value: "session" }),
});

/**
 * In enabled (draft) mode the reader stega-encodes what it returns, so the
 * click-to-edit tag rides along invisibly inside the string. `raw` strips it, the
 * same way consumer code does when it needs the plain value.
 */
function titleOf(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const title = (entry as { title?: unknown }).title;
  return typeof title === "string" ? raw(title) : undefined;
}

describe("fetchValKey draft state", () => {
  test("draft content wins over the committed entry", async () => {
    const { server, calls } = fakeValServer((key) => ({
      status: 200,
      json: { path: PAGES, key, content: { title: "draft A" } },
    }));
    const fetchValKey = initFetchValKeyStega(server, async () => true, cookies);

    expect(titleOf(await fetchValKey(pagesVal, "/a"))).toBe("draft A");
    // The draft read must ask the server to apply pending patches — that is what
    // makes it a draft read at all.
    expect(calls).toEqual([{ key: "/a", applyPatches: true }]);
  });

  test("an entry DELETED in the draft state renders nothing", async () => {
    // Regression: a 404 from the draft read was indistinguishable from "could not
    // ask", so the reader fell back to the committed entry and rendered a page the
    // editor had just deleted.
    const { server } = fakeValServer(() => ({
      status: 404,
      json: { message: "Entry not found: /a in /pages.val.ts" },
    }));
    const fetchValKey = initFetchValKeyStega(server, async () => true, cookies);

    expect(await fetchValKey(pagesVal, "/a")).toBeUndefined();
  });

  test("an entry ADDED in the draft state is reachable", async () => {
    // Its key exists only in a pending patch, so the local source knows nothing
    // about it: the answer can only come from the draft read.
    const { server } = fakeValServer((key) => ({
      status: 200,
      json: { path: PAGES, key, content: { title: "drafted B" } },
    }));
    const fetchValKey = initFetchValKeyStega(server, async () => true, cookies);

    expect(titleOf(await fetchValKey(pagesVal, "/b"))).toBe("drafted B");
  });

  test("a server error falls back to the committed entry rather than blanking", async () => {
    const { server } = fakeValServer(() => ({
      status: 500,
      json: { message: "boom" },
    }));
    const fetchValKey = initFetchValKeyStega(server, async () => true, cookies);

    expect(titleOf(await fetchValKey(pagesVal, "/a"))).toBe("committed A");
  });

  test("disabled (production) never asks the server", async () => {
    const { server, calls } = fakeValServer(() => ({
      status: 500,
      json: { message: "should not be called" },
    }));
    const fetchValKey = initFetchValKeyStega(
      server,
      async () => false,
      cookies,
    );

    expect(titleOf(await fetchValKey(pagesVal, "/a"))).toBe("committed A");
    expect(calls).toEqual([]);
  });
});

describe("resolveDraftOrCommittedEntry", () => {
  const committed = () => Promise.resolve({ title: "committed" });
  const noCommitted = () => Promise.resolve(undefined);

  test("draft content wins", async () => {
    const draft: DraftJsonEntry = { status: "content", content: { a: 1 } };
    expect(await resolveDraftOrCommittedEntry(draft, committed)).toEqual({
      a: 1,
    });
  });

  test("absent means absent — the committed entry is not consulted", async () => {
    let consulted = false;
    const result = await resolveDraftOrCommittedEntry(
      { status: "absent" },
      async () => {
        consulted = true;
        return { title: "committed" };
      },
    );
    expect(result).toBeUndefined();
    expect(consulted).toBe(false);
  });

  test("unavailable falls back", async () => {
    expect(
      await resolveDraftOrCommittedEntry({ status: "unavailable" }, committed),
    ).toEqual({ title: "committed" });
    expect(
      await resolveDraftOrCommittedEntry(
        { status: "unavailable" },
        noCommitted,
      ),
    ).toBeUndefined();
  });
});
