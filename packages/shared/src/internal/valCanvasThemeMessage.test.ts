import {
  DEFAULT_CANVAS_SELECTION,
  DEFAULT_CANVAS_SELECTION_SOFT,
  VAL_CANVAS_MESSAGE,
  isValCanvasStudioMessage,
} from "./valCanvasProtocol";

/**
 * What a `theme` message is allowed to carry.
 *
 * Not a formatting preference. The bridge writes both colours straight into a
 * `<style>` element in the CUSTOMER's document with `dangerouslySetInnerHTML`,
 * and any window holding a handle on that page can `postMessage` to it — so a
 * value containing `</style>` is a script tag away from running in someone
 * else's site. This guard is the only thing in between, which is why it is a
 * whitelist of the shapes the studio can produce rather than an escape.
 */
describe("the theme message's colours", () => {
  const themeMessage = (selection: unknown, selectionSoft: unknown) => ({
    val: VAL_CANVAS_MESSAGE,
    type: "theme",
    selection,
    selectionSoft,
  });

  it("accepts what the studio actually sends", () => {
    expect(
      isValCanvasStudioMessage(
        themeMessage(DEFAULT_CANVAS_SELECTION, DEFAULT_CANVAS_SELECTION_SOFT),
      ),
    ).toBe(true);
    // A generated ramp step and its derived soft fill, in the two shapes
    // `themeCustomProperties` produces.
    expect(
      isValCanvasStudioMessage(
        themeMessage("#8655f0", "rgba(134, 85, 240, 0.4)"),
      ),
    ).toBe(true);
    // Shorthand hex: `s.color({ format: "hex" })` accepts it, so the ramp can
    // be generated from it and the page can be told about it.
    expect(isValCanvasStudioMessage(themeMessage("#fff", "#fff"))).toBe(true);
  });

  it.each([
    ["breaking out of the style element", "</style><script>x</script>"],
    ["closing the rule and opening another", "#079455; } body { color: red"],
    ["a url() that phones home", "url(https://example.test/pixel)"],
    ["a keyword the studio never sends", "red"],
    ["an expression", "var(--anything)"],
    ["nothing at all", ""],
  ])("rejects %s", (_what, value) => {
    const failures: string[] = [];
    if (isValCanvasStudioMessage(themeMessage(value, "#079455"))) {
      failures.push(`accepted as selection: ${JSON.stringify(value)}`);
    }
    if (isValCanvasStudioMessage(themeMessage("#079455", value))) {
      failures.push(`accepted as selectionSoft: ${JSON.stringify(value)}`);
    }
    expect(failures).toEqual([]);
  });

  it("rejects a theme message that carries no colours", () => {
    expect(
      isValCanvasStudioMessage({ val: VAL_CANVAS_MESSAGE, type: "theme" }),
    ).toBe(false);
    expect(isValCanvasStudioMessage(themeMessage(1, 2))).toBe(false);
  });

  it("still accepts the message types that carry no colour", () => {
    expect(
      isValCanvasStudioMessage({ val: VAL_CANVAS_MESSAGE, type: "rescan" }),
    ).toBe(true);
    expect(
      isValCanvasStudioMessage({ val: VAL_CANVAS_MESSAGE, type: "highlight" }),
    ).toBe(true);
  });
});
