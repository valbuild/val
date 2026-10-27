import { StaleModules } from "./StaleModules";
import { mfp } from "./testSystem";

/**
 * A pass is "snapshot, await across the seam, covers". Anything that lands
 * during the await has to survive the `covers`, or the index answers from a
 * snapshot taken before the change — for a discard, with the discarded text
 * still in it.
 */
describe("marks made during a pass survive it", () => {
  const A = mfp("/a.val.ts");
  const B = mfp("/b.val.ts");

  it("clears what the pass saw and keeps what arrived while it ran", () => {
    const stale = new StaleModules("search:invalidate");
    stale.mark([A, B]);

    const pass = stale.begin();
    // The pass is away. B changes again before it comes back.
    stale.mark([B]);
    stale.covers([A, B], pass);

    expect(stale.staleModules()).toEqual([B]);
    expect(stale.coveredModules().sort()).toEqual([A, B]);
    expect(stale.needsPass()).toBe(true);
  });

  it("a mark that predates the pass is cleared even if it came late", () => {
    const stale = new StaleModules("search:invalidate");
    stale.mark([A]);
    const pass = stale.begin();
    stale.covers([A], pass);
    expect(stale.staleModules()).toEqual([]);
    expect(stale.needsPass()).toBe(false);
  });

  it("without a pass token, covers clears everything it is given", () => {
    const stale = new StaleModules("references:invalidate");
    stale.mark([A]);
    stale.covers([A]);
    expect(stale.staleModules()).toEqual([]);
  });

  it("the next pass after an interleaved mark clears it", () => {
    const stale = new StaleModules("search:invalidate");
    stale.mark([A]);
    const first = stale.begin();
    stale.mark([A]);
    stale.covers([A], first);
    expect(stale.staleModules()).toEqual([A]);

    const second = stale.begin();
    stale.covers([A], second);
    expect(stale.staleModules()).toEqual([]);
  });
});
