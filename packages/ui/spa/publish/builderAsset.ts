/**
 * Where the bundler's WebAssembly is served from.
 *
 * Nothing here imports `@valbuild/tanstack-build`, which is the point: that
 * package reaches `@rolldown/browser`, which is ESM-only and WASI-backed, and
 * `require(esm)` wants Node 24.9+ where this repository's jest is CommonJS.
 * `@valbuild/tanstack-build` runs its own build assertions in a `tsx` child
 * process for the same reason; see `splitEnvMarkers.test.ts` there.
 *
 * The binary is 10.9 MB and does NOT travel with the Studio's bundle — see
 * `build/rolldownWasm.ts` for the measurements that decided that. It is served
 * from `DEFAULT_STATIC_HOST`, addressed by the SHA-256 of its own bytes, and
 * the URL is printed into the one place rolldown asks for it.
 */

/**
 * The global a deployment sets to serve the binary from somewhere else.
 *
 * An air-gapped install, a mirror, a test. Read at the moment rolldown's loader
 * module is evaluated — inside the chunk the Studio dynamically imports — so
 * setting it any time before the builder is loaded is early enough, and no
 * rebuild is needed.
 *
 * Kept identical to `RUNTIME_OVERRIDE_GLOBAL` in `build/rolldownWasm.ts`, which
 * is what the built bundle actually reads. `rolldownWasm.test.ts` pins the two
 * together: this constant is what the Studio would have to agree with, and a
 * rename on one side alone is silent.
 */
export const RUNTIME_OVERRIDE_GLOBAL = "__VAL_ROLLDOWN_WASM_URL__";
