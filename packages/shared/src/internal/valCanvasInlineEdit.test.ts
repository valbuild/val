import {
  BRIDGE_CAPABILITIES,
  ANSWERED_BEFORE_CAPABILITIES,
  bridgeAnswers,
  isValCanvasPageMessage,
  isValCanvasStudioMessage,
  VAL_CANVAS_MESSAGE,
} from "./valCanvasProtocol";

describe("editing on the page, over the canvas protocol", () => {
  const title = {
    path: '/app/page.val.ts?p="title"',
    kind: "string",
    value: "Our people",
  };
  const body = {
    path: '/app/page.val.ts?p="body"',
    kind: "richtext",
    value: [
      {
        tag: "p",
        children: [
          "We are ",
          { tag: "span", styles: ["bold"], children: ["forty"] },
        ],
      },
    ],
  };
  const edit = {
    val: VAL_CANVAS_MESSAGE,
    type: "editInline",
    requestId: "inline-1",
    candidates: [title, body],
  };

  test("the studio's editInline is read whole", () => {
    expect(isValCanvasStudioMessage(edit)).toBe(true);
    expect(isValCanvasStudioMessage({ ...edit, candidates: [] })).toBe(true);
    expect(
      isValCanvasStudioMessage({
        ...edit,
        candidates: [{ ...title, multiline: true }],
      }),
    ).toBe(true);
  });

  test("...and refused with a part missing, or a field that is not one", () => {
    expect(isValCanvasStudioMessage({ ...edit, requestId: undefined })).toBe(
      false,
    );
    expect(isValCanvasStudioMessage({ ...edit, candidates: undefined })).toBe(
      false,
    );
    for (const candidate of [
      { ...title, kind: "number" },
      { ...title, value: 7 },
      { ...title, path: undefined },
      { ...title, multiline: "yes" },
      // A string where a document belongs, and a node that is not one.
      { ...body, value: "We are forty" },
      { ...body, value: [{ children: ["no tag"] }] },
      { ...body, value: [{ tag: "p", children: [7] }] },
    ]) {
      expect(
        isValCanvasStudioMessage({ ...edit, candidates: [candidate] }),
      ).toBe(false);
    }
  });

  test("the studio can end an edit", () => {
    expect(
      isValCanvasStudioMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "stopInlineEdit",
      }),
    ).toBe(true);
  });

  test("the page says an edit started, what was typed, and that it ended", () => {
    for (const message of [
      { type: "inlineEditStarted", requestId: "inline-1", path: title.path },
      { type: "inlineEdit", path: title.path, value: "Our team" },
      { type: "inlineEdit", path: body.path, value: body.value },
      { type: "inlineEditEnded", path: title.path },
      { type: "inlineEditUnavailable", requestId: "inline-1" },
    ]) {
      expect(
        isValCanvasPageMessage({ val: VAL_CANVAS_MESSAGE, ...message }),
      ).toBe(true);
    }
  });

  test("...and is not heard when what it says is not a field's value", () => {
    for (const message of [
      { type: "inlineEditStarted", path: title.path },
      { type: "inlineEdit", path: title.path, value: 7 },
      { type: "inlineEdit", path: title.path, value: [{ nope: true }] },
      { type: "inlineEdit", value: "Our team" },
      { type: "inlineEditEnded" },
      { type: "inlineEditUnavailable" },
    ]) {
      expect(
        isValCanvasPageMessage({ val: VAL_CANVAS_MESSAGE, ...message }),
      ).toBe(false);
    }
  });

  test("a bridge of this release answers it; one from before the list does not", () => {
    expect(BRIDGE_CAPABILITIES).toContain("editInline");
    expect(ANSWERED_BEFORE_CAPABILITIES).not.toContain("editInline");
    expect(bridgeAnswers([...BRIDGE_CAPABILITIES], "editInline")).toBe(true);
    expect(bridgeAnswers(undefined, "editInline")).toBe(false);
    expect(bridgeAnswers(["readPage"], "editInline")).toBe(false);
  });

  const selection = {
    anchor: { block: 0, offset: 2 },
    head: { block: 1, offset: 0 },
  };
  const rect = { top: 10, left: 20, width: 300, height: 40 };

  test("the page says what is selected in a richtext, and where it is", () => {
    const report = {
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditSelection",
      path: body.path,
      selection,
      rect,
    };
    expect(isValCanvasPageMessage(report)).toBe(true);
    expect(isValCanvasPageMessage({ ...report, selection: null })).toBe(true);
    expect(isValCanvasPageMessage({ ...report, caret: rect })).toBe(true);
    expect(isValCanvasPageMessage({ ...report, caret: null })).toBe(true);
    for (const wrong of [
      { rect: undefined },
      { rect: { ...rect, width: "wide" } },
      { caret: { top: 1 } },
      { selection: { anchor: { block: 0, offset: 2 } } },
      { selection: { ...selection, head: { block: -1, offset: 0 } } },
      { selection: { ...selection, head: { block: 0, offset: 1.5 } } },
      { path: undefined },
    ]) {
      expect(isValCanvasPageMessage({ ...report, ...wrong })).toBe(false);
    }
  });

  test("the studio sends what a control made of the document", () => {
    const apply = {
      val: VAL_CANVAS_MESSAGE,
      type: "applyInlineEdit",
      path: body.path,
      value: body.value,
      selection,
    };
    expect(isValCanvasStudioMessage(apply)).toBe(true);
    expect(isValCanvasStudioMessage({ ...apply, selection: null })).toBe(true);
    for (const wrong of [
      { value: "We are forty" },
      { value: [{ children: ["no tag"] }] },
      { selection: undefined },
      { selection: { anchor: { block: 0, offset: 0 } } },
      { path: undefined },
    ]) {
      expect(isValCanvasStudioMessage({ ...apply, ...wrong })).toBe(false);
    }
  });
});
