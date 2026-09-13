import { Module } from "node:module";

/**
 * Node's `require`, resolving as if from `filename`.
 *
 * Use this instead of importing `createRequire` from `node:module` directly.
 * webpack special-cases a `createRequire` binding imported from `module` /
 * `node:module`: it tries to resolve the call's argument at build time, and
 * when the argument is not a literal it gives up with
 *
 *     module.createRequire failed parsing argument.
 *
 * Our argument is never a literal — it is a path inside the user's project,
 * known only at runtime — so there is nothing for that analysis to find, and
 * nothing the warning can tell anyone. It is emitted on every build of every
 * Next app that bundles `@valbuild/server` into its Val API route, which is
 * all of them. Reaching `createRequire` through the `Module` class is the same
 * function and is not what webpack tags, so the call is invisible to it.
 *
 * It has to stay a real `node:module` import: jest's module registry hands out
 * its own `node:module`, and a `require` obtained around it (via
 * `process.getBuiltinModule`, say) would resolve against the real filesystem
 * rather than the registry the tests run in.
 */
export function createNodeRequire(filename: string): NodeRequire {
  return Module.createRequire(filename);
}
