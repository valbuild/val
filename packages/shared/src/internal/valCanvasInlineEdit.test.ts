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
});
