import {
  initVal,
  type JsonSource,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import { createSystem } from "./createSystem";
import { RecordingActivity } from "./activity";
import {
  JSON_ENTRY_KEYS_PER_REQUEST,
  type FetchJsonEntries,
  type JsonEntryResult,
} from "./react/jsonEntriesBatch";

/**
 * Loading `.jsonValues()` entries in batches (phase 10 of
 * `docs/plans/one-content-model.md`).
 *
 * Loading every entry of a record was quadratic: one `GET /json` per entry,
 * and the record's view rebuilt for each entry that arrived -- about 44 s for
 * 10,000. These pin the shape that replaced it: a request carries many keys,
 * what landed is applied as one batch, and a bulk load gives way to the
 * editor rather than queueing it.
 *
 * The seam is the network edge (`GET /json` with `keys`); everything behind
 * it is the system the Studio runs.
 */

const { c, s } = initVal();
const POSTS = "/posts.val.ts" as ModuleFilePath;

function postsModule(n: number) {
  const source: Record<string, JsonSource<{ title: string }>> = {};
  for (let i = 0; i < n; i++) {
    source[`/posts/${i}`] = c.json<{ title: string }>(() =>
      Promise.resolve({ default: { title: `Post ${i}` } }),
    );
  }
  return c.define(
    "/posts.val.ts",
    s.record(s.object({ title: s.string() })).jsonValues(),
    source,
  );
}

function titleOf(key: string): SourcePath {
  return `/posts.val.ts?p="${key}"."title"` as SourcePath;
}

/**
 * The server's side of `GET /json`: answers each key with its post, or with
 * what `fail` says. Requests can be held, to see what the store does while
 * they are in flight.
 */
function world(n: number, onServer: number = n) {
  const requests: string[][] = [];
  const failing = new Map<string, string>();
  let throwing: string | null = null;
  let held: (() => void)[] | null = null;
  const fetchJsonEntries: FetchJsonEntries = async (moduleFilePath, keys) => {
    requests.push([...keys]);
    if (held !== null) {
      const queue = held;
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    if (throwing !== null) throw new Error(throwing);
    const results: Record<string, JsonEntryResult> = {};
    for (const key of keys) {
      const failure = failing.get(key);
      if (failure !== undefined) {
        results[key] = { status: "error", message: failure };
        continue;
      }
      const i = Number(key.slice("/posts/".length));
      // Deleted on disk since the module was read: `missing` in the answer.
      if (moduleFilePath !== POSTS || !(i < onServer)) continue;
      results[key] = { status: "ok", content: { title: `Post ${i}` } };
    }
    return results;
  };
  let seq = 0;
  const activity = new RecordingActivity(() => ++seq);
  const system = createSystem({
    activity,
    fetchJsonEntries,
    fetchPatches: async (patchIds) => ({
      patches: [],
      errors: Object.fromEntries(patchIds.map((id) => [id, "none here"])),
    }),
    hostBridge: {
      preview: async () => ({ status: "unknown-module" }),
      customValidate: async () => ({ status: "validated", errors: false }),
    },
  });
  system.host.receive([postsModule(n)]);
  return {
    system,
    sourceStore: system.sourceStore,
    activity,
    requests,
    fail: (key: string, message: string) => failing.set(key, message),
    heal: () => failing.clear(),
    throwWith: (message: string | null) => {
      throwing = message;
    },
    /** Hold every request from now on until `release`. */
    hold: () => {
      held = [];
    },
    release: () => {
      const queue = held ?? [];
      held = null;
      for (const resolve of queue) resolve();
    },
    inFlight: () => held?.length ?? 0,
  };
}

function keysOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `/posts/${i}`);
}

describe("reading `.jsonValues()` entries", () => {
  test("a window of rows read in one tick is one request", async () => {
    const { sourceStore, requests, activity } = world(100);
    const rows = keysOf(19);

    const reads = await Promise.all(
      rows.map((key) => sourceStore.get(titleOf(key), null)),
    );

    expect(reads.map((read) => read.status)).toEqual(
      rows.map(() => "resolved-head"),
    );
    expect(requests).toEqual([rows]);
    // One batch, one view of the record: not one per row.
    expect(activity.count("source:apply-json-entries")).toBe(1);
  });

  test("a key the answer does not mention fails, rather than never settling", async () => {
    const { sourceStore } = world(10, 1);
    const reads = await Promise.all([
      sourceStore.get(titleOf("/posts/0"), null),
      sourceStore.get(titleOf("/posts/7"), null),
    ]);
    expect(reads[0].status).toBe("resolved-head");
    expect(reads[1]).toEqual({
      status: "error",
      message: "Entry not found: /posts/7 in /posts.val.ts",
    });
    expect(sourceStore.peek(titleOf("/posts/7"))).toEqual({
      status: "entry-failed",
      key: "/posts/7",
      message: "Entry not found: /posts/7 in /posts.val.ts",
    });
  });

  test("a request that throws fails every key it carried", async () => {
    const { sourceStore, throwWith } = world(10);
    throwWith("connection reset");
    const reads = await Promise.all(
      keysOf(3).map((key) => sourceStore.get(titleOf(key), null)),
    );
    expect(reads).toEqual(
      keysOf(3).map(() => ({ status: "error", message: "connection reset" })),
    );
  });
});

describe("whether a record's entries are all here", () => {
  /**
   * Asked on every render of whatever waits for a full load (a reference
   * scan's status, a rename guard), so it is answered once per view of the
   * modules asked about, not once per read: at 10,000 posts, walking the
   * markers per render was a tenth of the busy time of "used by"
   * (`scenarios/measure/results.md`, "The Studio, built").
   */
  test("is worked out once per view, and the same object until it moves", async () => {
    const { sourceStore, activity } = world(100);
    const before = activity.position();
    const first = sourceStore.entriesStatus([POSTS]);
    expect(sourceStore.entriesStatus([POSTS])).toBe(first);
    expect(sourceStore.entriesStatus([POSTS])).toBe(first);
    expect(activity.count("source:entries-status", { since: before })).toBe(1);

    await sourceStore.loadAllEntries(POSTS);
    const complete = sourceStore.entriesStatus([POSTS]);
    expect(complete.status).toBe("complete");
    expect(sourceStore.entriesStatus([POSTS])).toBe(complete);
    expect(activity.count("source:entries-status", { since: before })).toBe(2);
  });
});

describe("loading every entry of a record", () => {
  test("requests carry many keys, and the view is rebuilt per batch, not per entry", async () => {
    const n = 1_000;
    const { sourceStore, requests, activity } = world(n);

    await sourceStore.loadAllEntries(POSTS);

    expect(sourceStore.entriesStatus([POSTS]).status).toBe("complete");
    expect(sourceStore.entriesProgress(POSTS)).toEqual({
      total: n,
      loaded: n,
      failed: 0,
    });
    // Every key asked for once.
    expect(requests.flat().sort()).toEqual(keysOf(n).sort());
    // Many to a request: the URL budget decides, at a few dozen of these.
    expect(requests.length).toBeLessThanOrEqual(Math.ceil(n / 25));
    const applies = activity.count("source:apply-json-entries");
    expect(applies).toBeGreaterThan(0);
    expect(applies).toBeLessThanOrEqual(requests.length);
    expect(activity.count("source:receive-json-entry")).toBe(n);
  });

  test("the record's root is the same object to every peek between batches", async () => {
    const { sourceStore } = world(200);
    const root = "/posts.val.ts?p=" as SourcePath;
    const roots = new Set<unknown>();
    const off = sourceStore.events.on("source:change", () => {
      const first = sourceStore.peek(root);
      const second = sourceStore.peek(root);
      // Reference-stable while nothing moved: a fresh object per peek is a
      // render loop (`architecture/stores.md`).
      expect(second).toBe(first);
      roots.add(first);
    });
    await sourceStore.loadAllEntries(POSTS);
    off();
    expect(roots.size).toBeGreaterThan(0);
  });

  test("a listener is woken only by the batch that brought its entry", async () => {
    const { sourceStore } = world(300);
    const woken: string[] = [];
    const offs = ["/posts/0", "/posts/299"].map((key) =>
      sourceStore.addListener(titleOf(key), `field:${key}`, () =>
        woken.push(key),
      ),
    );
    await sourceStore.loadAllEntries(POSTS);
    offs.forEach((off) => off());
    expect(woken.sort()).toEqual(["/posts/0", "/posts/299"]);
  });

  test("at most a few bulk requests are in flight at once", async () => {
    const { sourceStore, hold, release, inFlight } = world(1_000);
    hold();
    const loading = sourceStore.loadAllEntries(POSTS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inFlight()).toBeGreaterThan(0);
    expect(inFlight()).toBeLessThanOrEqual(3);
    release();
    await loading;
    expect(sourceStore.entriesStatus([POSTS]).status).toBe("complete");
  });

  test("an entry someone opens during a load goes out at once, not behind it", async () => {
    const { sourceStore, requests, hold, release } = world(1_000);
    hold();
    const loading = sourceStore.loadAllEntries(POSTS);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sent = requests.length;
    const read = sourceStore.get(titleOf("/posts/999"), null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests.slice(sent)).toEqual([["/posts/999"]]);
    release();
    expect((await read).status).toBe("resolved-head");
    await loading;
    // ...and the load did not ask for it again.
    expect(requests.flat().filter((key) => key === "/posts/999")).toHaveLength(
      1,
    );
  });

  test("two callers share one load", async () => {
    const { sourceStore, requests } = world(500);
    await Promise.all([
      sourceStore.loadAllEntries(POSTS),
      sourceStore.loadAllEntries(POSTS),
    ]);
    expect(requests.flat()).toHaveLength(500);
  });

  test("when its only caller stops waiting, what has not gone out does not go", async () => {
    const { sourceStore, requests, hold, release } = world(1_000);
    hold();
    const abort = new AbortController();
    const loading = sourceStore.loadAllEntries(POSTS, { signal: abort.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sent = requests.length;
    abort.abort();
    release();
    await loading;
    // What was in flight landed; nothing more was asked for.
    expect(requests.length).toBe(sent);
    const progress = sourceStore.entriesProgress(POSTS);
    expect(progress.loaded).toBe(requests.flat().length);
    expect(progress.loaded).toBeLessThan(1_000);
    // Nothing is left `entry-loading` for a reader to wait on forever.
    expect(sourceStore.peek(titleOf("/posts/998")).status).toBe(
      "entry-missing",
    );
  });

  test("a batch that fails is reported, and Try again loads it", async () => {
    const { sourceStore, fail, heal } = world(200);
    const failed = keysOf(200).slice(50, 150);
    for (const key of failed) fail(key, "Val Build could not be reached");

    await sourceStore.loadAllEntries(POSTS);

    const status = sourceStore.entriesStatus([POSTS]);
    expect(status.status).toBe("error");
    expect(status.errors).toHaveLength(failed.length);
    // A failed entry is not asked for again by itself...
    await sourceStore.loadAllEntries(POSTS);
    expect(sourceStore.entriesStatus([POSTS]).status).toBe("error");

    // ...only by trying again, which then works.
    heal();
    await sourceStore.retryEntries(
      POSTS,
      status.errors.map((error) => error.key),
    );
    expect(sourceStore.entriesStatus([POSTS]).status).toBe("complete");
  });

  test("a few failed entries are tried again as a read", async () => {
    const { sourceStore, fail, heal, requests } = world(50);
    fail("/posts/3", "Val Build could not be reached");
    await sourceStore.loadAllEntries(POSTS);
    heal();
    const sent = requests.length;
    await sourceStore.retryEntries(POSTS, ["/posts/3"]);
    expect(requests.slice(sent)).toEqual([["/posts/3"]]);
    expect(sourceStore.entriesStatus([POSTS]).status).toBe("complete");
    expect(JSON_ENTRY_KEYS_PER_REQUEST).toBeGreaterThan(1);
  });
});
