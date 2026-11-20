import {
  initVal,
  type Json,
  type JsonSource,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "./createSystem";
import { RecordingActivity } from "./activity";
import { createFakeManifest } from "./testManifest";
import type {
  FetchJsonEntries,
  JsonEntryResult,
} from "./react/jsonEntriesBatch";

/**
 * A `.jsonValues()` entry is read on a BASE: `GET /json` answers with the
 * server's content for it, without patches. When the base the Studio holds
 * moves (a publish, a deploy, a proposal's saves) while a read is on its way,
 * the answer is the OLD base's entry. Applied, it was the new base's for good:
 * nothing asks for an entry that is already here.
 *
 * So an answer is for the base it was asked on, and one that comes back to a
 * base that has moved since is asked for again.
 */

const { c, s } = initVal();
const POSTS = "/posts.val.ts" as ModuleFilePath;
const N = 5;

function postsModule() {
  const source: Record<string, JsonSource<{ title: string }>> = {};
  for (let i = 0; i < N; i++) {
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

function titleOf(i: number): SourcePath {
  return `/posts.val.ts?p="/posts/${i}"."title"` as SourcePath;
}

/** The module's source as the server sends it: one marker per entry. */
function markers(publishedBy: string | null): Json {
  const source: Record<string, Json> = {};
  for (let i = 0; i < N; i++) {
    source[`/posts/${i}`] =
      publishedBy === null
        ? { _type: "json" }
        : { _type: "json", patch_id: publishedBy };
  }
  return source;
}

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function setup() {
  const server = {
    base: markers(null),
    /** What an entry reads as on the server's current base. */
    title: (i: number) => `Post ${i}`,
  };
  let systemRef: System | null = null;
  const fake = createFakeManifest({
    bases: () =>
      new Map([
        [
          POSTS,
          { source: server.base, schema: systemRef?.schemaStore.get(POSTS) },
        ],
      ]),
    chain: () => [],
  });
  const requests: string[][] = [];
  let held: (() => void)[] | null = null;
  /**
   * The server answers when the request reaches it -- on the base it has
   * then -- and the answer can be held on its way back.
   */
  const fetchJsonEntries: FetchJsonEntries = async (moduleFilePath, keys) => {
    requests.push([...keys]);
    const results: Record<string, JsonEntryResult> = {};
    for (const key of keys) {
      const i = Number(key.slice("/posts/".length));
      results[key] = { status: "ok", content: { title: server.title(i) } };
    }
    if (held !== null) {
      const queue = held;
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    return results;
  };
  let seq = 0;
  const activity = new RecordingActivity(() => ++seq);
  const system = createSystem({
    activity,
    fetchJsonEntries,
    fetchManifest: fake.fetchManifest,
    fetchModule: fake.fetchModule,
    fetchPatches: async (patchIds) => ({
      patches: [],
      errors: Object.fromEntries(patchIds.map((id) => [id, "none here"])),
    }),
  });
  systemRef = system;
  system.host.receive([postsModule()]);
  const stat = () =>
    system.stat.receiveStat({ patches: [], baseSha: JSON.stringify(server) });
  const title = (i: number) => {
    const peeked = system.sourceStore.peek(titleOf(i));
    return peeked.status === "ready" ? peeked.data : peeked.status;
  };
  /** A publish: the server's base moves, and every entry with it. */
  const publish = () => {
    server.base = markers("published");
    server.title = (i) => `Published ${i}`;
  };
  return {
    system,
    stat,
    title,
    publish,
    requests,
    hold: () => {
      held = [];
    },
    release: () => {
      const queue = held ?? [];
      held = null;
      for (const resolve of queue) resolve();
    },
  };
}

describe("an entry read while the base moves", () => {
  test("a read answered on the old base is asked for again on the new one", async () => {
    const { system, stat, title, publish, requests, hold, release } = setup();
    stat();
    await settle();
    hold();
    const read = system.sourceStore.get(titleOf(0), null);
    await settle();
    expect(requests).toEqual([["/posts/0"]]);

    publish();
    stat();
    await settle();
    release();
    const answer = await read;
    await settle();

    expect(title(0)).toBe("Published 0");
    expect(answer).toMatchObject({
      status: "resolved-head",
      data: "Published 0",
    });
    expect(requests).toEqual([["/posts/0"], ["/posts/0"]]);
  });

  test("a bulk load across a base move ends with every entry of the new base", async () => {
    const { system, stat, title, publish, hold, release } = setup();
    stat();
    await settle();
    hold();
    const load = system.sourceStore.loadAllEntries(POSTS);
    await settle();

    publish();
    stat();
    await settle();
    release();
    await load;
    await settle();

    expect(Array.from({ length: N }, (_, i) => title(i))).toEqual(
      Array.from({ length: N }, (_, i) => `Published ${i}`),
    );
    expect(system.sourceStore.entriesStatus([POSTS])).toMatchObject({
      status: "complete",
    });
  });
});
