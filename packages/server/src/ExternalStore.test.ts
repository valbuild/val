import {
  initVal,
  type ExternalRecordSrc,
  type ModuleFilePath,
  type ValModule,
} from "@valbuild/core";
import { ExternalStore } from "./ExternalStore";
import {
  defineExternal,
  err,
  ok,
  type BoundExternalRecord,
  type ExternalKeyPage,
  type ExternalRecords,
  type Returns,
} from "./externalRecords";

const { s, c } = initVal();

const POSTS = "/content/posts.val.ts" as ModuleFilePath;

const postsVal = c.define(
  "/content/posts.val.ts",
  s.record(s.object({ title: s.string() })).external("posts"),
  c.external(),
);

type Item = { title: string };

/** An adapter built from parts, so each test names only what it cares about. */
function build(
  adapter: Partial<{
    keys: (args: {
      cursor: string | null;
      limit: number;
    }) => Promise<Returns<ExternalKeyPage>>;
    get: (keys: string[]) => Promise<Returns<Record<string, Item | null>>>;
    count: false | (() => Promise<Returns<number>>);
    search: false | undefined;
    maxPageSize: number;
    maxBatchSize: number;
    version: () => Promise<Returns<string>>;
  }>,
  definition?: Parameters<typeof defineExternal<{ id: number }>>[0],
  // The `around` seam is what changes the retry scope, so tests pick it per case.
  withAround = false,
): { store: ExternalStore; records: ExternalRecords } {
  const { entry, modules } = withAround
    ? defineExternal<{ id: number }>({
        around: (run) => run({ id: 1 }),
        ...definition,
      })
    : defineExternal<{ id: number }>(definition);
  const records = modules({
    posts: entry(postsVal, {
      keys: async (args) =>
        adapter.keys
          ? adapter.keys(args)
          : ok({ keys: [] as string[], cursor: null }),
      get: async (keys) => (adapter.get ? adapter.get(keys) : ok({})),
      put: async () => ok(undefined),
      delete: async () => ok(undefined),
      ...(adapter.count !== undefined
        ? {
            count:
              adapter.count === false
                ? (false as const)
                : async () =>
                    (adapter.count as () => Promise<Returns<number>>)(),
          }
        : {}),
      ...("search" in adapter ? { search: adapter.search } : {}),
      ...(adapter.maxPageSize !== undefined
        ? { maxPageSize: adapter.maxPageSize }
        : {}),
      ...(adapter.maxBatchSize !== undefined
        ? { maxBatchSize: adapter.maxBatchSize }
        : {}),
      ...(adapter.version !== undefined ? { version: adapter.version } : {}),
    }),
  });
  return { store: new ExternalStore(records), records };
}

/**
 * Pages of `total` keys, named k0..k(total-1), honouring cursor and limit.
 *
 * The return type is annotated because `ok()` takes `NoInfer<T>`: written
 * without a contextual type it would infer `unknown` and fail at every use.
 */
function pagedKeys(
  total: number,
  calls: { limit: number }[],
): (args: {
  cursor: string | null;
  limit: number;
}) => Promise<Returns<ExternalKeyPage>> {
  return async ({ cursor, limit }) => {
    calls.push({ limit });
    const from = cursor === null ? 0 : Number(cursor);
    const keys = [];
    for (let i = from; i < Math.min(from + limit, total); i++) {
      keys.push(`k${i}`);
    }
    const next = from + keys.length;
    return ok({ keys, cursor: next >= total ? null : String(next) });
  };
}

describe("ExternalStore chunks without the caller knowing", () => {
  test("a store that lists ten at a time still answers a request for fifty", () => {
    // maxPageSize is a hint for the fetcher, not a ceiling the UI sees: the
    // Studio's page size must not depend on how a record is stored.
    const calls: { limit: number }[] = [];
    const { store } = build({ keys: pagedKeys(200, calls), maxPageSize: 10 });
    return store.keys(POSTS, { cursor: null, limit: 50 }).then((res) => {
      expect(res.status).toBe("success");
      if (res.status !== "success") return;
      expect(res.value.keys).toHaveLength(50);
      expect(res.value.keys[0]).toBe("k0");
      expect(res.value.keys[49]).toBe("k49");
      expect(calls).toHaveLength(5);
      // The cursor handed back is the store's own, so the next page continues
      // where this one stopped rather than re-listing.
      expect(res.value.cursor).toBe("50");
    });
  });

  test("a short page ends the walk even when the cursor is not null", async () => {
    // Trusting only the cursor loops forever against a store that forgets to
    // null it. Surviving that is worth more than reporting it.
    let called = 0;
    const { store } = build({
      keys: async () => {
        called++;
        return ok({ keys: [], cursor: "never-null" });
      },
    });
    const res = await store.keys(POSTS, { cursor: null, limit: 50 });
    expect(res.status).toBe("success");
    expect(called).toBe(1);
  });

  test("fifty keys reach the adapter in one batch when it allows it", async () => {
    const batches: string[][] = [];
    const { store } = build({
      get: async (keys) => {
        batches.push(keys);
        return ok(Object.fromEntries(keys.map((k) => [k, { title: k }])));
      },
    });
    const keys = Array.from({ length: 50 }, (_, i) => `k${i}`);
    const res = await store.get(POSTS, keys);
    expect(res.status).toBe("success");
    expect(batches).toHaveLength(1);
  });

  test("a key the store does not have comes back as null, not absent", async () => {
    // "No such entry" and "the adapter forgot it" have to be tellable apart.
    const { store } = build({ get: async () => ok({ a: { title: "A" } }) });
    const res = await store.get(POSTS, ["a", "b"]);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value).toEqual({ a: { title: "A" }, b: null });
  });

  test("no keys means no adapter call at all", async () => {
    let called = 0;
    const { store } = build({
      get: async () => {
        called++;
        return ok({});
      },
    });
    expect((await store.get(POSTS, [])).status).toBe("success");
    expect(called).toBe(0);
  });
});

describe("retry scope follows the transaction", () => {
  const retryable = err({ message: "deadlock", retryable: true });

  /**
   * A scope with TWO calls in it, which is the only way to tell the two retry
   * scopes apart: chunked paging where the second page fails once.
   *
   * Whole-scope retry re-lists page 1; per-operation retry does not.
   */
  const twoPageWalk = (withAround: boolean) => {
    const listed: (string | null)[] = [];
    let failures = 0;
    const { store } = build(
      {
        keys: async ({ cursor }) => {
          listed.push(cursor);
          if (cursor === null) {
            return ok({ keys: ["a"], cursor: "1" });
          }
          if (failures === 0) {
            failures++;
            return retryable;
          }
          return ok({ keys: ["b"], cursor: null });
        },
        maxPageSize: 1,
      },
      { retry: { attempts: 3, backoff: () => 0 } },
      withAround,
    );
    return { store, listed };
  };

  test("with `around`, the WHOLE scope is re-entered", async () => {
    // A database aborts its transaction on the first error and answers
    // everything after it with "current transaction is aborted", so retrying
    // the failed statement inside a dead transaction fails every time. The
    // first page is therefore listed twice — which is also why `put` has to be
    // an upsert and `delete` has to tolerate an absent key.
    const { store, listed } = twoPageWalk(true);
    const res = await store.keys(POSTS, { cursor: null, limit: 10 });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value.keys).toEqual(["a", "b"]);
    expect(listed).toEqual([null, "1", null, "1"]);
  });

  test("without `around`, only the failing call repeats", async () => {
    // No scope to invalidate, so repeating one request is both correct and far
    // cheaper than repeating the ones that preceded it.
    const { store, listed } = twoPageWalk(false);
    const res = await store.keys(POSTS, { cursor: null, limit: 10 });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value.keys).toEqual(["a", "b"]);
    expect(listed).toEqual([null, "1", "1"]);
  });

  test("the attempt counter reaches the adapter", async () => {
    // Not only for logging: an adapter can widen a timeout, skip a read replica
    // that may be lagging, or give up on its own terms.
    const attempts: number[] = [];
    const { entry, modules } = defineExternal({
      retry: { attempts: 3, backoff: () => 0 },
    });
    const store = new ExternalStore(
      modules({
        posts: entry(postsVal, {
          keys: async () => ok({ keys: [], cursor: null }),
          get: async (_keys, ctx) => {
            attempts.push(ctx.attempt);
            return retryable;
          },
          put: async () => ok(undefined),
          delete: async () => ok(undefined),
        }),
      }),
    );
    expect((await store.get(POSTS, ["a"])).status).toBe("error");
    expect(attempts).toEqual([1, 2, 3]);
  });

  test("the author reaches the adapter", async () => {
    let seen: unknown = "never set";
    const { entry, modules } = defineExternal();
    const store = new ExternalStore(
      modules({
        posts: entry(postsVal, {
          keys: async () => ok({ keys: [], cursor: null }),
          get: async (_keys, ctx) => {
            seen = ctx.author;
            return ok({});
          },
          put: async () => ok(undefined),
          delete: async () => ok(undefined),
        }),
      }),
    );
    await store.get(POSTS, ["a"], {
      author: { id: "u1", email: "a@example.com" },
    });
    expect(seen).toEqual({ id: "u1", email: "a@example.com" });
  });

  test("without `around` there is no `tx` to ignore", async () => {
    let seen: unknown = "never set";
    const { entry, modules } = defineExternal();
    const store = new ExternalStore(
      modules({
        posts: entry(postsVal, {
          keys: async () => ok({ keys: [], cursor: null }),
          get: async (_keys, ctx) => {
            seen = ctx.tx;
            return ok({});
          },
          put: async () => ok(undefined),
          delete: async () => ok(undefined),
        }),
      }),
    );
    await store.get(POSTS, ["a"]);
    expect(seen).toBeUndefined();
  });

  test("a THROWN error is never retried", async () => {
    // Val cannot tell a rate limit from a TypeError, and retrying a bug three
    // times only fails slower. An adapter that knows better returns
    // err({ retryable: true }).
    let calls = 0;
    const { store } = build(
      {
        get: async () => {
          calls++;
          throw new Error("boom");
        },
      },
      { retry: { attempts: 5, backoff: () => 0 } },
    );
    const res = await store.get(POSTS, ["a"]);
    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.error.message).toBe("boom");
    expect(res.error.retryable).toBe(false);
    expect(calls).toBe(1);
  });

  test("an error the adapter did not mark retryable is not retried", async () => {
    let calls = 0;
    const { store } = build(
      {
        get: async () => {
          calls++;
          return err({ message: "no such table" });
        },
      },
      { retry: { attempts: 5, backoff: () => 0 } },
    );
    expect((await store.get(POSTS, ["a"])).status).toBe("error");
    expect(calls).toBe(1);
  });

  test("retry: false gives up immediately, even on a retryable issue", async () => {
    let calls = 0;
    const { store } = build(
      {
        get: async () => {
          calls++;
          return retryable;
        },
      },
      { retry: false },
    );
    expect((await store.get(POSTS, ["a"])).status).toBe("error");
    expect(calls).toBe(1);
  });

  test("a policy function decides, and can stop early", async () => {
    const seen: number[] = [];
    let calls = 0;
    const { store } = build(
      {
        get: async () => {
          calls++;
          return retryable;
        },
      },
      {
        retry: (attempt, issue) => {
          seen.push(attempt);
          expect(issue.message).toBe("deadlock");
          return attempt < 2 ? 0 : false;
        },
      },
    );
    expect((await store.get(POSTS, ["a"])).status).toBe("error");
    expect(calls).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  test("the failure is reported with the adapter's own message", async () => {
    const { store } = build({ get: async () => err({ message: "42 down" }) });
    const res = await store.get(POSTS, ["a"]);
    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.error.message).toBe("42 down");
  });
});

describe("warnings", () => {
  test("a successful call can still say something", async () => {
    const { store } = build({
      get: async () =>
        ok({ a: { title: "A" } }, [{ message: "read from a replica" }]),
    });
    const res = await store.get(POSTS, ["a"]);
    expect(res.status).toBe("success");
    expect(res.warnings.map((w) => w.message)).toEqual(["read from a replica"]);
  });

  test("warnings from a rolled-back attempt are dropped", async () => {
    // They describe work that no longer happened. Keeping them would show an
    // editor a warning about a transaction that was thrown away.
    let calls = 0;
    const { store } = build(
      {
        get: async () => {
          calls++;
          return calls === 1
            ? ok({ a: null }, [{ message: "first try" }])
            : ok({ a: { title: "A" } }, [{ message: "second try" }]);
        },
        keys: async () => ok({ keys: [], cursor: null }),
      },
      { retry: { attempts: 3, backoff: () => 0 } },
      true,
    );
    const res = await store.get(POSTS, ["a"]);
    expect(res.warnings.map((w) => w.message)).toEqual(["first try"]);
  });
});

describe("count has three answers, and they are not the same answer", () => {
  test("a store that can count is asked", async () => {
    const { store } = build({ count: async () => 4321 });
    const res = await store.count(POSTS);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value).toEqual({ status: "counted", count: 4321, exact: true });
  });

  test("count: false is DECLINED, which is not zero", async () => {
    // Rendering "declined" as 0 is exactly the bug this shape prevents.
    const { store } = build({ count: false });
    const res = await store.count(POSTS);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value).toEqual({ status: "declined" });
  });

  test("omitted, Val counts by paging keys — content is never fetched", async () => {
    const calls: { limit: number }[] = [];
    let getCalls = 0;
    const { store } = build({
      keys: pagedKeys(25, calls),
      get: async () => {
        getCalls++;
        return ok({});
      },
      maxPageSize: 10,
    });
    const res = await store.count(POSTS);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value).toEqual({ status: "counted", count: 25, exact: true });
    expect(getCalls).toBe(0);
  });

  test("the derived walk is bounded, and says so", async () => {
    // A 200,000-entry store must not be walked to the end to fill in a pager.
    const calls: { limit: number }[] = [];
    const { store } = build(
      { keys: pagedKeys(1000, calls), maxPageSize: 10 },
      { countPageLimit: 3 },
    );
    const res = await store.count(POSTS);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value).toEqual({ status: "counted", count: 30, exact: false });
    expect(calls).toHaveLength(3);
  });
});

describe("search", () => {
  test("false is DECLINED — the editor is told, not shown zero hits", async () => {
    const { store } = build({ search: false });
    const res = await store.search(POSTS, {
      text: "x",
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value.status).toBe("declined");
  });

  test("omitted asks Val to derive it, without touching the store", async () => {
    let keyCalls = 0;
    const { store } = build({
      keys: async () => {
        keyCalls++;
        return ok({ keys: [], cursor: null });
      },
    });
    const res = await store.search(POSTS, {
      text: "x",
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value.status).toBe("derive");
    // Searching a 100k-entry store must fetch nothing on the editor's behalf.
    expect(keyCalls).toBe(0);
  });
});

describe("version", () => {
  test("absent costs freshness, never function", async () => {
    const { store } = build({});
    const res = await store.version(POSTS);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value).toBeNull();
  });

  test("present, it is returned", async () => {
    const { store } = build({ version: async () => ok("v7") });
    const res = await store.version(POSTS);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.value).toBe("v7");
  });
});

describe("bindings", () => {
  test("an unbound module is an error, not an empty page", async () => {
    const { store } = build({});
    const res = await store.keys("/nope.val.ts" as ModuleFilePath, {
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.error.message).toContain("No external adapter is bound");
  });

  test("the label and the module path are both reachable", () => {
    const { store } = build({});
    expect(store.labels()).toEqual(["posts"]);
    expect(store.bindingOf(POSTS)?.label).toBe("posts");
    expect(store.bindingOfLabel("posts")?.moduleFilePath).toBe(POSTS);
    expect(store.has(POSTS)).toBe(true);
  });

  test("binding one module twice is refused at definition time", () => {
    // Whichever won would be arbitrary, and the loser's queries would simply
    // never run.
    //
    // TypeScript already refuses this — a second key cannot equal the schema's
    // one label — so the call has to be made through a view that has forgotten
    // the label check. That is not a hole being papered over: it is exactly the
    // caller this runtime guard exists for, a project whose `val/external.ts`
    // is JavaScript, or was never typechecked.
    const builder = defineExternal();
    const unchecked: {
      modules: (
        entries: Record<
          string,
          BoundExternalRecord<ValModule<ExternalRecordSrc>>
        >,
      ) => ExternalRecords;
    } = builder;
    const bind = () =>
      builder.entry(postsVal, {
        keys: async () => ok({ keys: [], cursor: null }),
        get: async () => ok({}),
        put: async () => ok(undefined),
        delete: async () => ok(undefined),
      });
    expect(() => unchecked.modules({ posts: bind(), other: bind() })).toThrow(
      /bound twice/,
    );
  });
});
