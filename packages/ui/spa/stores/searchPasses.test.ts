import { initVal, type ModuleFilePath } from "@valbuild/core";
import { SearchStore, type SourceSnapshot } from "./SearchStore";

/**
 * Passes over the search index run one after the other.
 *
 * A pass lets the thread go between slices, and the Studio asks again as
 * each batch of a `.jsonValues()` record lands, so passes with different
 * snapshots of the record were running interleaved on one index. A record is
 * indexed by entry identity, so each pass took out what the other had just
 * put in: at 10,000 posts the tab froze and search never answered (phase 10).
 */
const { s } = initVal();
const POSTS = "/posts.val.ts" as ModuleFilePath;
const schema = s.record(s.object({ title: s.string() }))["executeSerialize"]();

function snapshotOf(word: string, n: number): SourceSnapshot {
  const source: Record<string, { title: string }> = {};
  for (let i = 0; i < n; i++) source[`/p${i}`] = { title: `${word} ${i}` };
  return { [POSTS]: { source, schema, complete: true } };
}

test("passes started together end at the newest snapshot, and end", async () => {
  const store = new SearchStore();
  const passes = ["alpha", "bravo", "charlie", "delta"].map((word) =>
    store.reindex(snapshotOf(word, 3_000)),
  );
  await Promise.all(passes);
  const newest = await store.search("delta", 5);
  const older = await store.search("alpha", 5);
  expect(newest.status === "results" && newest.total).toBe(3_000);
  expect(older.status === "results" && older.total).toBe(0);
}, 20_000);
