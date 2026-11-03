import { initVal, type ModuleFilePath } from "@valbuild/core";
import { RETRY_FAILED_ENTRY_AFTER_MS, bundleSource } from "./sources";

const { s, c } = initVal();
const PATH = "/notes.val.ts" as ModuleFilePath;

/**
 * The bundle's `.jsonValues()` entries: its own `import()`s, started when an
 * entry is first read and kept by build -- except one that failed, which a
 * chunk that did not load (a deploy, a dropped connection) is.
 */
test("an entry whose import failed is imported again by a read a while later", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  let calls = 0;
  const notes = c.define(
    PATH,
    s.record(s.object({ title: s.string() })).jsonValues(),
    {
      a: c.json(async () => {
        calls++;
        if (calls === 1) throw new Error("chunk failed to load");
        return { default: { title: "Note A" } };
      }),
    },
  );
  const bundle = bundleSource(new Map([[PATH, notes]]));
  const read = async () => {
    const first = bundle.entry(PATH, "a");
    if (first.status !== "pending") return first;
    await first.ready;
    return bundle.entry(PATH, "a");
  };
  expect(await read()).toMatchObject({ status: "failed" });
  // Read again at once: still failed, and not imported again -- a component
  // re-rendering must not suspend on it each time.
  expect(await read()).toMatchObject({ status: "failed" });
  expect(calls).toBe(1);
  now.mockReturnValue(1_000_000 + RETRY_FAILED_ENTRY_AFTER_MS);
  expect(await read()).toEqual({
    status: "ready",
    content: { title: "Note A" },
    from: "bundle",
  });
  expect(calls).toBe(2);
  // And kept once it loaded.
  expect(bundle.entry(PATH, "a")).toMatchObject({ status: "ready" });
  expect(calls).toBe(2);
  now.mockRestore();
});
