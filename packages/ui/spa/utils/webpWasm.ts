import encode, { init } from "@jsquash/webp/encode";
import { simd } from "wasm-feature-detect";
import webpEncWasmUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url";
import webpEncSimdWasmUrl from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";

/**
 * libwebp in WebAssembly, for a browser whose canvas cannot write WebP.
 *
 * `canvas.toBlob(cb, "image/webp")` answers with a PNG in Safari, so
 * `s.image({ encode: { type: "webp" } })` would otherwise mean "a JPEG,
 * scaled down" on every iPhone. This is Squoosh's encoder, published on its own
 * as `@jsquash/webp` (Apache-2.0).
 *
 * This module is only ever reached through a dynamic `import()` from
 * `encodeImage`, and only once `shouldEncodeWithWasm` has said so -- so its
 * JavaScript is a lazy chunk, and its WebAssembly is fetched by nobody whose
 * canvas wrote WebP. `e2e/tanstack/webp.spec.ts` holds both of those to it.
 *
 * ## Where the binary comes from
 *
 * Not from beside the bundle. `/api/val/static` serves the Studio out of a
 * record of text embedded in the server bundle, which corrupts a binary (see
 * `build/staticWasm.ts`), so the two `.wasm` files are served from the static
 * host, addressed by their SHA-256 -- the same place, and the same build step,
 * as rolldown's. The `?url` imports below are how this module learns those
 * URLs: the build rewrites them to `<host>/webp/<sha256>/<file>`, and the dev
 * server serves the files straight out of `node_modules`.
 *
 * We fetch and compile the module ourselves and hand it to `init`, rather than
 * letting the Emscripten glue find its own file with
 * `new URL("webp_enc.wasm", import.meta.url)` -- that URL is relative to
 * wherever the glue's chunk was served from, which is `/api/val/static`.
 *
 * One exception, which is the glue's and not worth working around: if
 * instantiating the module we hand over THROWS, the glue logs it, rejects
 * `init`, and then fetches its own URL anyway. In a build that URL is the same
 * rewritten static-host address, so the cost is one extra download of the same
 * bytes, after a failure that is already rare (a `LinkError`, or no memory for
 * the instance). Stopping it means a hand-written `instantiateWasm` that never
 * throws -- and one that does not call back leaves `init` pending forever,
 * which would hang the upload instead.
 */

/**
 * The compiled module, once per page. A failed download is forgotten, so the
 * next upload asks again: a dropped connection on the first photo should not
 * mean JPEGs for the rest of the session. A module that compiled is kept even
 * when what follows fails -- the bytes are addressed by their hash, so fetching
 * them again would fetch the same ones.
 */
let compiling: Promise<WebAssembly.Module> | null = null;

/**
 * The instance, which IS let go when anything goes wrong with it: a failed
 * `init`, or an `encode` that threw. Emscripten aborts on a failed allocation
 * and every later call into that instance throws, so keeping it would turn one
 * photo too big for memory into every upload falling back until a reload. The
 * next upload instantiates again, from the compiled module, with no download.
 */
let initialising: Promise<unknown> | null = null;

function compiled(): Promise<WebAssembly.Module> {
  if (compiling === null) {
    const attempt = compile();
    attempt.catch(() => {
      if (compiling === attempt) {
        compiling = null;
      }
    });
    compiling = attempt;
  }
  return compiling;
}

function initialised(): Promise<unknown> {
  if (initialising === null) {
    /*
     * `init(module)` is the call `encode.js` implements -- one argument that is
     * a `WebAssembly.Module` -- and the one the package's README documents. Its
     * `.d.ts` declares only the options form; this typechecks against that
     * because a `WebAssembly.Module` has no properties of its own.
     */
    const attempt = compiled().then((module) => init(module));
    attempt.catch(() => {
      if (initialising === attempt) {
        initialising = null;
      }
    });
    initialising = attempt;
  }
  return initialising;
}

async function compile(): Promise<WebAssembly.Module> {
  /*
   * Which binary is chosen HERE, and has to be the one `init` chooses.
   *
   * `init` runs the same `simd()` check and picks the Emscripten glue to match;
   * the glue's imports and the module's exports only line up when both halves
   * came from the same build. `simd()` validates a fixed module, so asked twice
   * in one engine it answers the same -- and if they ever disagreed, the
   * instantiation throws a `LinkError`, which is a failed load, not a wrong
   * image.
   */
  const url = (await simd()) ? webpEncSimdWasmUrl : webpEncWasmUrl;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  /*
   * `compile` rather than `compileStreaming`: streaming insists on
   * `Content-Type: application/wasm`, and a bucket, mirror or dev proxy that
   * says `application/octet-stream` would turn a good binary into a failure.
   * 345 KB is not worth that.
   */
  return WebAssembly.compile(await response.arrayBuffer());
}

/**
 * Encode the pixels as WebP at `quality` (0-1, as `canvas.toBlob` takes it).
 *
 * Rejects when the encoder cannot be loaded or fails; `encodeImage` turns that
 * into the next fallback, never into a failed upload.
 */
export async function encodeWebpWithWasm(
  imageData: ImageData,
  quality: number,
): Promise<Blob> {
  // Before `encode`, always: called uninitialised, `encode` runs `init()`
  // itself and fetches the glue's own bundle-relative URL.
  const instance = initialised();
  await instance;
  let bytes: ArrayBuffer;
  try {
    bytes = await encode(imageData, {
      // libwebp's quality is 0-100.
      quality: Math.round(quality * 100),
    });
  } catch (err) {
    if (initialising === instance) {
      initialising = null;
    }
    throw err;
  }
  return new Blob([bytes], { type: "image/webp" });
}
