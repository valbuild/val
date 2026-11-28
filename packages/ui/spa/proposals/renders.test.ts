import { isLaterRender } from "@valbuild/shared/internal";
import { connectRenderTarget, mintRender, resetRenders } from "./renders";
import { setStagedPreview } from "./quickPreviewControl";

/**
 * The Studio's render ids (`renders.ts`): each change a tool makes to what
 * the page shows gets one, and the page in the preview is told it once the
 * change can be on it -- an edit at once, with the version the page has to
 * show first; a quick preview or a Build once the page in front is of its
 * staged files.
 */
describe("render ids in the Studio", () => {
  let sent: { id: string; seq: number | null }[];
  let disconnect: () => void;
  beforeEach(() => {
    resetRenders();
    setStagedPreview(null);
    sent = [];
    disconnect = connectRenderTarget((id, seq) => sent.push({ id, seq }));
  });
  afterEach(() => disconnect());

  test("each change gets a later id than the one before", () => {
    const first = mintRender({ inputs: null, seq: 1 });
    const second = mintRender({ inputs: null, seq: 2 });
    expect(isLaterRender(second, first)).toBe(true);
  });

  test("an edit is sent at once, with the version the page has to show", () => {
    const id = mintRender({ inputs: null, seq: 7 });
    expect(sent).toEqual([{ id, seq: 7 }]);
  });

  test("a later id never needs less than an earlier one: shown, it shows them all", () => {
    mintRender({ inputs: null, seq: 9 });
    const later = mintRender({ inputs: null, seq: 4 });
    const none = mintRender({ inputs: null, seq: null });
    expect(sent.find((s) => s.id === later)?.seq).toBe(9);
    expect(sent.find((s) => s.id === none)?.seq).toBe(9);
  });

  test("a quick preview is sent once the page in front is of its staged files", () => {
    const id = mintRender({ inputs: "abc", seq: 3 });
    expect(sent).toEqual([]);
    setStagedPreview({ inputs: "other", status: "shown" });
    expect(sent).toEqual([]);
    setStagedPreview({ inputs: "abc", status: "shown" });
    expect(sent).toEqual([{ id, seq: 3 }]);
  });

  test("so is a Build, once its build serves them", () => {
    const id = mintRender({ inputs: "abc", seq: null });
    setStagedPreview({ inputs: "abc", status: "served" });
    expect(sent).toEqual([{ id, seq: null }]);
  });

  test("a quick preview that failed is no page of the change", () => {
    mintRender({ inputs: "abc", seq: null });
    setStagedPreview({ inputs: "abc", status: "failed", message: "no" });
    expect(sent).toEqual([]);
  });

  test("a page loaded again is told again what it shows", () => {
    const edit = mintRender({ inputs: null, seq: 2 });
    const preview = mintRender({ inputs: "abc", seq: 2 });
    disconnect();
    setStagedPreview({ inputs: "abc", status: "shown" });
    const again: { id: string; seq: number | null }[] = [];
    disconnect = connectRenderTarget((id, seq) => again.push({ id, seq }));
    expect(again.map((s) => s.id)).toEqual([edit, preview]);
  });

  test("an edit not saved yet is sent once its save says the version", async () => {
    let saved: (seq: number) => void = () => {};
    const id = mintRender({
      inputs: null,
      seq: new Promise<number | null>((resolve) => (saved = resolve)),
    });
    expect(sent).toEqual([]);
    saved(12);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([{ id, seq: 12 }]);
  });

  test("ids are sent in the order they were made: a later one waits for the save before it", async () => {
    let saved: (seq: number) => void = () => {};
    const edit = mintRender({
      inputs: null,
      seq: new Promise<number | null>((resolve) => (saved = resolve)),
    });
    const next = mintRender({ inputs: null, seq: 3 });
    expect(sent).toEqual([]);
    saved(5);
    await Promise.resolve();
    await Promise.resolve();
    // And the later one needs at least what the save made.
    expect(sent).toEqual([
      { id: edit, seq: 5 },
      { id: next, seq: 5 },
    ]);
  });

  test("an edit after a quick preview is on a page of the staged files", () => {
    setStagedPreview({ inputs: "abc", status: "shown" });
    mintRender({ inputs: "abc", seq: 1 });
    // The quick preview is gone from the front: the page is the site's.
    setStagedPreview({ inputs: "abc", status: "failed", message: "gone" });
    const edit = mintRender({ inputs: null, seq: 2 });
    expect(sent.map((s) => s.id)).not.toContain(edit);
    setStagedPreview({ inputs: "abc", status: "shown" });
    expect(sent.map((s) => s.id)).toContain(edit);
  });
});
