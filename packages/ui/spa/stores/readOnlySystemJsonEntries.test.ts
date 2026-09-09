import { initVal } from "@valbuild/core";
import type { SourcePath } from "@valbuild/core";
import { createReadOnlySystem } from "./readOnlySystem";

/**
 * A read-only system - the history pane's - reading a `.jsonValues()` entry.
 *
 * The pane renders a commit through the real field components, and a
 * `.jsonValues()` record's source is only `{_type:"json"}` markers: the content
 * is per entry, fetched when something reads inside one. The read-only system
 * had no fetcher, so `SourceStore.loadEntry` refused every read and each entry
 * stayed a marker - which the pane drew as an empty field. That is worse than
 * an error: an empty value is a claim that the author left it blank, about
 * content that is simply stored somewhere else.
 *
 * The module is handed over through `host.receive`, the way the live system
 * takes content in, rather than as a hand-serialized schema: `receive` JSON
 * round-trips the source, so what the stores end up holding is markers with no
 * thunk behind them - exactly the shape a commit's archived source has.
 */
const { c, s } = initVal();

const TITLE_IN_A = '/blogs.val.ts?p="/a"."title"' as SourcePath;

const jsonValuesModule = () =>
  c.define(
    "/blogs.val.ts",
    s.record(s.object({ title: s.string() })).jsonValues(),
    { "/a": c.json(() => Promise.resolve({ default: { title: "Alpha" } })) },
  );

function systemWith(
  fetchJsonEntry?: Parameters<typeof createReadOnlySystem>[0]["fetchJsonEntry"],
) {
  const system = createReadOnlySystem({
    schemas: {},
    sources: {},
    ...(fetchJsonEntry ? { fetchJsonEntry } : {}),
    noServerReason: "nothing pending here",
  });
  system.host.receive([jsonValuesModule()]);
  return system;
}

describe("a read-only system reading a jsonValues entry", () => {
  test("fetches the entry and resolves a path inside it", async () => {
    const asked: string[] = [];
    const system = systemWith(async (moduleFilePath, key) => {
      asked.push(`${moduleFilePath} ${key}`);
      return { status: "ok", content: { title: "Alpha" } };
    });
    const read = await system.sourceStore.get(TITLE_IN_A, null);
    if (read.status !== "resolved-head") {
      throw new Error(`expected the read to resolve, got ${read.status}`);
    }
    expect(read.data).toEqual("Alpha");
    expect(asked).toEqual(["/blogs.val.ts /a"]);
  });

  /*
   * The regression this exists for. With no fetcher the read is REFUSED - which
   * is honest - but the pane had no fetcher to give it, so every entry in every
   * commit took this path, and a refused read is what the pane drew as blank.
   */
  test("refuses the read when there is nowhere to fetch from", async () => {
    const system = systemWith(undefined);
    const read = await system.sourceStore.get(TITLE_IN_A, null);
    expect(read.status).not.toBe("resolved-head");
  });

  test("reports a failed fetch rather than an empty field", async () => {
    const system = systemWith(async () => ({
      status: "error",
      message: "the archive host is unreachable",
    }));
    const read = await system.sourceStore.get(TITLE_IN_A, null);
    expect(read.status).not.toBe("resolved-head");
  });

  // Looking must stay free: `peek` is what a nav count or a badge uses, and it
  // must never trigger the fetch that `get` does.
  test("peeking does not fetch", () => {
    const asked: string[] = [];
    const system = systemWith(async (moduleFilePath, key) => {
      asked.push(`${moduleFilePath} ${key}`);
      return { status: "ok", content: { title: "Alpha" } };
    });
    system.sourceStore.peek(TITLE_IN_A);
    expect(asked).toEqual([]);
  });
});
