// Polyfills for the jsdom test environment used by useValStega.suspense.test.ts.
// JSDOM doesn't ship TextEncoder / ReadableStream, but @valbuild/shared touches
// both at module load. babel-jest hoists `import` declarations above non-import
// statements, so the polyfill needs to live in a separate module that is
// imported BEFORE @valbuild/core — its side effects then run as part of that
// first require(), before @valbuild/core is evaluated.
import { ReadableStream } from "node:stream/web";
import { TextEncoder, TextDecoder } from "node:util";

if (typeof globalThis.TextEncoder === "undefined") {
  Reflect.set(globalThis, "TextEncoder", TextEncoder);
  Reflect.set(globalThis, "TextDecoder", TextDecoder);
}
if (typeof globalThis.ReadableStream === "undefined") {
  Reflect.set(globalThis, "ReadableStream", ReadableStream);
}
