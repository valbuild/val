/**
 * @jest-environment jsdom
 */
import { focusTextEntry } from "./fieldTextEntry";

/**
 * Where the caret goes in a field's row when Select & edit could not put it
 * in the text on the page.
 */
describe("focusTextEntry", () => {
  const row = (html: string, root: ParentNode = document.body) => {
    const element = document.createElement("div");
    element.innerHTML = html;
    root.appendChild(element);
    return element;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("the text, not the button before it", () => {
    const field = row(
      `<button type="button">Label</button><input type="checkbox" /><input id="text" />`,
    );
    expect(focusTextEntry(field)).toBe(true);
    expect(document.activeElement?.id).toBe("text");
  });

  test("a richtext's editable element", () => {
    const field = row(
      `<div class="toolbar"><button>B</button></div><div id="doc" contenteditable="true"></div>`,
    );
    expect(focusTextEntry(field)).toBe(true);
    expect(document.activeElement?.id).toBe("doc");
  });

  test("not a text that cannot be written", () => {
    const field = row(
      `<input readonly /><textarea disabled></textarea><div inert><input /></div><textarea id="text"></textarea>`,
    );
    expect(focusTextEntry(field)).toBe(true);
    expect(document.activeElement?.id).toBe("text");
  });

  test("nothing, in a field with nothing to type in", () => {
    const field = row(`<button type="button">Upload</button>`);
    expect(focusTextEntry(field)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  // The Studio is in a shadow root, whose focus the document does not see.
  test("inside a shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const field = row(`<input id="text" />`, shadow);
    expect(focusTextEntry(field)).toBe(true);
    expect(shadow.activeElement?.id).toBe("text");
  });
});
