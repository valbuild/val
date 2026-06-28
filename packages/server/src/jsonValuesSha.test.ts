import { initVal } from "@valbuild/core";
import {
  computeJsonEntrySha,
  getJsonItemSchemaHash,
  getSchemaHashFromJsonSha,
  isJsonEntryShaCurrent,
  jsonEntrySchemaHashIsStale,
} from "./jsonValuesSha";

const { s } = initVal();

describe("jsonValues validation sha", () => {
  const item = s.object({ title: s.string() });

  test("is deterministic for the same schema + content", () => {
    expect(computeJsonEntrySha(item, { title: "a" })).toBe(
      computeJsonEntrySha(item, { title: "a" }),
    );
  });

  test("content change flips the sha but keeps the schema component", () => {
    const sha1 = computeJsonEntrySha(item, { title: "a" });
    const sha2 = computeJsonEntrySha(item, { title: "b" });
    expect(sha1).not.toBe(sha2);
    // same schema → same schema-hash component (so only that entry revalidates)
    expect(getSchemaHashFromJsonSha(sha1)).toBe(getSchemaHashFromJsonSha(sha2));
  });

  test("schema change flips the schema component (forces record revalidation)", () => {
    const item2 = s.object({ title: s.string(), extra: s.number() });
    const shaA = computeJsonEntrySha(item, { title: "a" });
    const shaB = computeJsonEntrySha(item2, { title: "a" });
    expect(getJsonItemSchemaHash(item)).not.toBe(getJsonItemSchemaHash(item2));
    expect(getSchemaHashFromJsonSha(shaA)).not.toBe(
      getSchemaHashFromJsonSha(shaB),
    );
  });

  test("isJsonEntryShaCurrent detects content and schema drift", () => {
    const sha = computeJsonEntrySha(item, { title: "a" });
    expect(isJsonEntryShaCurrent(sha, item, { title: "a" })).toBe(true);
    // content drift
    expect(isJsonEntryShaCurrent(sha, item, { title: "changed" })).toBe(false);
    // schema drift
    const item2 = s.object({ title: s.string(), extra: s.number() });
    expect(isJsonEntryShaCurrent(sha, item2, { title: "a" })).toBe(false);
  });

  test("getSchemaHashFromJsonSha returns null for a non-composite sha", () => {
    expect(getSchemaHashFromJsonSha("1232132")).toBeNull();
  });

  test("jsonEntrySchemaHashIsStale detects schema drift WITHOUT reading content", () => {
    // sha was written against `item`; we never pass the content here.
    const storedSha = computeJsonEntrySha(item, { title: "a" });
    expect(jsonEntrySchemaHashIsStale(storedSha, item)).toBe(false);

    const changedItem = s.object({ title: s.string(), extra: s.number() });
    expect(jsonEntrySchemaHashIsStale(storedSha, changedItem)).toBe(true);

    // a hand-authored / legacy sha with no schema prefix is treated as stale
    expect(jsonEntrySchemaHashIsStale("1232132", item)).toBe(true);
  });
});
