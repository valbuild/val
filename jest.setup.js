/**
 * Fill in what jsdom does not have.
 *
 * These are part of the Node globals and of every browser, but jsdom does not
 * install them. That is not an abstract gap here: importing
 * `@valbuild/shared/internal` touches all of them at module scope — the richtext
 * conversion builds a `TextEncoder`, and `ApiRoutes` names `ReadableStream` in a
 * zod schema — so ANY jsdom suite that renders a component reaching shared code
 * dies on the import, before a single test runs, with a stack pointing at
 * richtext or at a route table rather than at anything the test is about.
 *
 * Assigned only when missing, because this file also runs for the node-env
 * suites, where the real globals are already there.
 */
const { TextEncoder, TextDecoder } = require("util");
const {
  ReadableStream,
  WritableStream,
  TransformStream,
} = require("stream/web");

const missing = {
  TextEncoder,
  TextDecoder,
  ReadableStream,
  WritableStream,
  TransformStream,
};
for (const [name, value] of Object.entries(missing)) {
  if (typeof globalThis[name] === "undefined") {
    globalThis[name] = value;
  }
}

/**
 * `window.matchMedia`, which jsdom also does not install.
 *
 * Different in kind from the globals above: those are missing everywhere, this
 * one exists only in a browser. Any component that asks a media query — the
 * Studio's mark asks `prefers-reduced-motion` before it blinks — throws
 * `window.matchMedia is not a function` on render, which reads as a broken
 * component rather than a missing global.
 *
 * Answers "no" to everything, and that is the right default for a test: a
 * component under test should take the ordinary branch unless it says otherwise,
 * and a test that cares can replace this. `addEventListener` is a no-op rather
 * than absent, because a listener registered in an effect is cleaned up on
 * unmount and a missing method turns that cleanup into a failure.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
