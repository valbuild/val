/**
 * The globals jsdom does not provide but the browser and node both do.
 *
 * Imported FIRST by any jsdom test that loads the store layer, because babel
 * preserves import order and these have to exist before the modules that use them
 * are evaluated — `splitPatchFileOps` builds a `TextEncoder` at module scope, so a
 * polyfill applied inside a `beforeEach` is already too late.
 *
 * A module rather than a jest `setupFiles` entry so the cost is paid only by the
 * files that need it, and so the reason is written next to the fix rather than in
 * a config file three directories up.
 *
 * Every assignment is guarded: in a node-environment test all of these already
 * exist, and overwriting the real ones with these would be a worse simulation
 * than not polyfilling at all.
 */
import { webcrypto } from "node:crypto";
import {
  ReadableStream,
  TransformStream,
  WritableStream,
} from "node:stream/web";
import { deserialize, serialize } from "node:v8";
import { TextDecoder, TextEncoder } from "node:util";

const globals = globalThis as Record<string, unknown>;

if (globals.TextEncoder === undefined) {
  globals.TextEncoder = TextEncoder;
}
if (globals.TextDecoder === undefined) {
  globals.TextDecoder = TextDecoder;
}
if (globals.structuredClone === undefined) {
  // Built from `node:v8` rather than taken from the global, because inside jest's
  // jsdom environment the global object IS jsdom's window and node's own
  // `structuredClone` is not on it. `serialize`/`deserialize` is the same
  // algorithm — which is exactly why the worker seam is tested with it.
  globals.structuredClone = (value: unknown) => deserialize(serialize(value));
}
if (globals.crypto === undefined) {
  globals.crypto = webcrypto;
} else {
  // jsdom ships a PARTIAL `crypto` — present, so a whole-object guard never
  // fires, but missing `randomUUID`, which `ValSyncEngine.createPatchId` calls.
  // Filled in per member rather than replaced, so jsdom's own implementations of
  // everything else stay in place.
  const existing = globals.crypto as { randomUUID?: unknown };
  if (typeof existing.randomUUID !== "function") {
    existing.randomUUID = webcrypto.randomUUID.bind(webcrypto);
  }
}
// The streams. jsdom has none of them, and the Studio's dependency graph reaches
// code that builds one at module scope — so, like `TextEncoder`, a polyfill
// applied later is already too late.
if (globals.ReadableStream === undefined) {
  globals.ReadableStream = ReadableStream;
}
if (globals.WritableStream === undefined) {
  globals.WritableStream = WritableStream;
}
if (globals.TransformStream === undefined) {
  globals.TransformStream = TransformStream;
}
