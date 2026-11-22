/** @jest-environment jsdom */
import { EMPTY_TEXT_ATTRIBUTE, markEmptyTextFields } from "./emptyTextFields";

const TITLE = '/app/page.val.ts?p="title"';
const ALT = '/app/page.val.ts?p="alt"';
const LEAD = '/app/page.val.ts?p="lead"';
const split = (attribute: string) => attribute.split(",");
// jsdom has no user agent stylesheet: an inline element says so itself here.

function page(html: string): HTMLElement {
  document.body.innerHTML = `<main>${html}</main>`;
  const main = document.querySelector("main");
  if (main === null) throw new Error("no page");
  return main;
}
const marks = (root: ParentNode) =>
  Array.from(root.querySelectorAll(`[${EMPTY_TEXT_ATTRIBUTE}]`)).map(
    (el) =>
      `${el.tagName.toLowerCase()}:${el.getAttribute(EMPTY_TEXT_ATTRIBUTE)}`,
  );

describe("keeping an emptied text pointable", () => {
  it("marks an emptied heading, as a block, and an emptied inline text as inline", () => {
    const root = page(
      `<h1 data-val-path='${TITLE}'></h1><p>By <span style="display: inline" data-val-path='${LEAD}'></span></p>`,
    );
    markEmptyTextFields(root, new Set([TITLE, LEAD]), split);
    expect(marks(root)).toEqual(["h1:block", "span:inline"]);
  });

  it("counts an edit tag's invisible characters and white space as nothing", () => {
    const root = page(`<h1 data-val-path='${TITLE}'>\u200b\u200c \n</h1>`);
    markEmptyTextFields(root, new Set([TITLE]), split);
    expect(marks(root)).toEqual(["h1:block"]);
  });

  it("an emptied richtext is empty even with its empty paragraph", () => {
    const root = page(`<div data-val-path='${LEAD}'><p></p></div>`);
    markEmptyTextFields(root, new Set([LEAD]), split);
    expect(marks(root)).toEqual(["div:block"]);
  });

  it("never grows what is empty by nature, or what shows something", () => {
    const root = page(
      [
        `<img data-val-path='${ALT}' alt="">`,
        `<input data-val-path='${TITLE}' value="">`,
        `<video><source data-val-path='${TITLE}'></video>`,
        // A richtext whose only content is an image is not empty.
        `<div data-val-path='${LEAD}'><p><img src="/a.png"></p></div>`,
      ].join(""),
    );
    markEmptyTextFields(root, new Set([TITLE, ALT, LEAD]), split);
    expect(marks(root)).toEqual([]);
  });

  it("leaves alone what the Studio did not say is an empty text: a spacer", () => {
    const root = page(
      `<div data-val-path='${TITLE}' title="Blog 1"></div><h1 data-val-path='${LEAD}'></h1>`,
    );
    markEmptyTextFields(root, new Set([LEAD]), split);
    expect(marks(root)).toEqual(["h1:block"]);
  });

  it("finds a field among the element's paths", () => {
    const root = page(
      `<a style="display: inline" data-val-path='${ALT},${TITLE}' href="/"></a>`,
    );
    markEmptyTextFields(root, new Set([TITLE]), split);
    expect(marks(root)).toEqual(["a:inline"]);
  });

  it("takes the mark off once it shows something, or is no longer said to be empty", () => {
    const root = page(
      `<h1 data-val-path='${TITLE}'></h1><h2 data-val-path='${LEAD}'></h2>`,
    );
    markEmptyTextFields(root, new Set([TITLE, LEAD]), split);
    expect(marks(root)).toEqual(["h1:block", "h2:block"]);
    const h1 = root.querySelector("h1");
    if (h1 === null) throw new Error("no heading");
    h1.textContent = "Typed again";
    markEmptyTextFields(root, new Set([TITLE, LEAD]), split);
    expect(marks(root)).toEqual(["h2:block"]);
    // Select turned off says nothing is: every mark goes.
    markEmptyTextFields(root, new Set(), split);
    expect(marks(root)).toEqual([]);
  });

  it("keeps the kind it was marked with, whatever its own room did to its display", () => {
    const root = page(
      `<span style="display: inline" data-val-path='${TITLE}'></span>`,
    );
    markEmptyTextFields(root, new Set([TITLE]), split);
    const span = root.querySelector("span");
    if (span === null) throw new Error("no span");
    span.style.display = "inline-block";
    markEmptyTextFields(root, new Set([TITLE]), split);
    expect(marks(root)).toEqual(["span:inline"]);
  });
});
