import { beginSiteOperation } from "./siteOperation";

describe("one site operation at a time", () => {
  test("a publish during an update is refused, naming the update", () => {
    const update = beginSiteOperation("update");
    expect(update.ok).toBe(true);
    expect(beginSiteOperation("publish")).toEqual({
      ok: false,
      busy: "update",
    });
    if (update.ok) update.release();
  });

  test("released, the next one may start; releasing twice frees nothing else", () => {
    const first = beginSiteOperation("publish");
    if (!first.ok) throw new Error("expected the lock");
    first.release();
    const second = beginSiteOperation("update");
    expect(second.ok).toBe(true);
    first.release();
    expect(beginSiteOperation("publish")).toEqual({
      ok: false,
      busy: "update",
    });
    if (second.ok) second.release();
  });
});
