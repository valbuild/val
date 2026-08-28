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
