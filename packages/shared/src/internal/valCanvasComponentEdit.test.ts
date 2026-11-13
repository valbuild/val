/** @jest-environment jsdom */
import {
  isOnValCanvasControls,
  isValCanvasComponentEdit,
  isValCanvasPageMessage,
  VAL_CANVAS_CONTROLS_ATTRIBUTE,
  VAL_CANVAS_MESSAGE,
} from "./valCanvasProtocol";

const LIST = '/page.val.ts?p="sections"';

describe("an edit the page asks the studio for", () => {
  test("the three edits there are", () => {
    expect(
      isValCanvasComponentEdit({ op: "move", list: LIST, from: 2, to: 0 }),
    ).toBe(true);
    expect(
      isValCanvasComponentEdit({ op: "remove", list: LIST, index: 0 }),
    ).toBe(true);
    expect(
      isValCanvasComponentEdit({ op: "insert", list: LIST, index: 4 }),
    ).toBe(true);
  });

  test("anything else is not one: a window hears from whatever holds a handle on it", () => {
    for (const value of [
      null,
      "move",
      { op: "move", list: LIST, from: 1 },
      { op: "move", list: LIST, from: -1, to: 0 },
      { op: "move", list: LIST, from: 1.5, to: 0 },
      { op: "remove", list: "", index: 0 },
      { op: "remove", index: 0 },
      { op: "insert", list: LIST, index: "0" },
      { op: "replace", list: LIST, index: 0 },
    ]) {
      expect(isValCanvasComponentEdit(value)).toBe(false);
    }
  });

  test("as a message from the page", () => {
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "componentEdit",
        edit: { op: "remove", list: LIST, index: 1 },
      }),
    ).toBe(true);
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "componentEdit",
        edit: { op: "remove" },
      }),
    ).toBe(false);
    expect(
      isValCanvasPageMessage({
        type: "componentEdit",
        edit: { op: "remove", list: LIST, index: 1 },
      }),
    ).toBe(false);
  });
});

describe("the controls drawn over a list are not the page's content", () => {
  test("a control inside a tagged element is still a control", () => {
    document.body.innerHTML = `
      <div data-val-path="/page.val.ts?p=&quot;sections&quot;.0">
        <p id="content">Content</p>
        <div ${VAL_CANVAS_CONTROLS_ATTRIBUTE}="">
          <button id="control"><svg id="icon"></svg></button>
        </div>
      </div>`;
    const control = document.getElementById("icon");
    const content = document.getElementById("content");
    expect(control && isOnValCanvasControls(control)).toBe(true);
    expect(content && isOnValCanvasControls(content)).toBe(false);
  });
});
