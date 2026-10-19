/**
 * Keeping the Studio's WebAssembly out of its bundle, and pointing the bundle
 * at where it really lives.
 *
 * Two things in the Studio carry a binary:
 *
 * - **rolldown**, which builds a site in the tab. The SPA dynamically imports
 *   `@valbuild/tanstack-build`, which imports `@rolldown/browser` -- 10.9 MB of
 *   WebAssembly.
 * - **libwebp** (`@jsquash/webp`), which writes WebP where the canvas cannot
 *   (Safari; see `spa/utils/webpWasm.ts`). Two builds of it, with and without
 *   SIMD, 281 KB and 346 KB; the encoder picks one at run time.
 *
 * Each loader names its binary with `new URL('./x.wasm', import.meta.url)`,
 * and Vite emits every one of those as an asset and rewrites the URL to point
 * at it. That asset is where the trouble is.
 *
 * `/api/val/static` is NOT a directory. `createUIRequestHandler` answers it out
 * of a `Record<string, string>` of base64 that `fix-server-hack.js` substitutes
 * into both server bundles at build time, and it builds that record with
 * `fs.readFileSync(file, "utf-8")`. So shipping a binary that way does two
 * things, neither of which anything would have noticed:
 *
 * - It CORRUPTS it. Read as utf-8 and written back, rolldown's 10,845,151 bytes
 *   come out 12,811,857 bytes and unequal. Any binary would.
 * - rolldown's base64 is 14,460,204 characters, as a string literal in each of
 *   the two server bundles -- and `@valbuild/tanstack-build`'s `wire.ts`
 *   DECLARES `@valbuild/ui` as a project dependency precisely so it lands in
 *   that project's vendor layer, so every project's layer would grow by that
 *   much.
 *
 * So every binary is served from `DEFAULT_STATIC_HOST` instead -- the content
 * service's `/v1/static`, which answers with a redirect to a public bucket --
 * and this module is what makes the built bundle ask for them there.
 *
 * ## One list, not one module per binary
 *
 * {@link STATIC_WASM} is every binary the Studio may load. Adding one is an
 * entry there, and the build, `verify-build.js` and the release's
 * `wasm:upload` all follow from it: the build writes the list into
 * {@link MANIFEST_FILE}, with how to find each file, and the uploader reads
 * nothing else. A `.wasm` the build emits that is NOT on the list fails the
 * build, because the alternative is the corrupted embed above.
 *
 * ## Addressed by content, not by version
 *
 * The URL is `<host>/<name>/<sha256 of the bytes>/<filename>`, where the
 * "host" is a base URL with a path (`https://content.val.build/v1/static`). A
 * version number would have to be kept in step with the release by hand; a
 * hash cannot be got wrong, because the URL the bundle points at IS the digest
 * of the bytes that bundle needs. Uploading is therefore "put it if it is
 * absent", and a `@valbuild/ui` build can never ask for a binary other than
 * the one it was built against.
 *
 * ## The runtime escape hatch
 *
 * What is printed is `globalThis.<overrideGlobal> ?? "<the content-addressed
 * URL>"`, one global per binary, so a deployment that must not reach the
 * static host -- an air-gapped install, a mirror, a test -- sets them before
 * the Studio loads the code that needs them, and needs no rebuild.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/**
 * Where the binaries are served from, unless `VAL_STATIC_HOST` says otherwise.
 *
 * A literal rather than an import of `DEFAULT_STATIC_HOST` from
 * `@valbuild/core`, which is the real source of truth: Vite loads a config file
 * by bundling it to ESM, and core's built entry is CommonJS, so the named
 * import fails at config load with "Named export not found". Kept honest by
 * `build/staticWasm.test.ts`, which asserts the two are the same string.
 */
export const DEFAULT_STATIC_HOST = "https://content.val.build/v1/static";

/** Where the manifest the release uploader reads is written. */
export const MANIFEST_FILE = "static-wasm.json";

/** A binary the Studio loads from the static host. */
export type StaticWasm = {
  /** The directory it is served under on the host. */
  name: string;
  /**
   * The packages to resolve, each FROM the one before it, starting at
   * `@valbuild/ui`. Through the package that declares the dependency rather
   * than from here, because from here would find whatever a hoist happened to
   * put in reach -- the version skew content addressing exists to rule out.
   */
  resolveThrough: readonly string[];
  /** The file, inside the last of those packages. Its basename is the name it is served under. */
  path: string;
  /**
   * The global a deployment sets to serve it from somewhere else.
   *
   * Read when the loader that names the binary is evaluated -- inside a chunk
   * the Studio imports lazily -- so setting it any time before that is early
   * enough.
   */
  overrideGlobal: string;
};

/** rolldown, which the Studio builds a site with. */
export const ROLLDOWN_WASM: StaticWasm = {
  name: "rolldown",
  resolveThrough: ["@valbuild/tanstack-build", "@rolldown/browser"],
  path: "dist/rolldown-binding.wasm32-wasi.wasm",
  // Forwarded into the builder's worker by `builderWorkerClient.ts`, by name.
  overrideGlobal: "__VAL_ROLLDOWN_WASM_URL__",
};

/** libwebp, for a canvas that cannot write WebP. See `spa/utils/webpWasm.ts`. */
export const WEBP_WASM: StaticWasm = {
  name: "webp",
  resolveThrough: ["@jsquash/webp"],
  path: "codec/enc/webp_enc.wasm",
  overrideGlobal: "__VAL_WEBP_WASM_URL__",
};

/** The same, built with WebAssembly SIMD, which most engines now have. */
export const WEBP_SIMD_WASM: StaticWasm = {
  name: "webp",
  resolveThrough: ["@jsquash/webp"],
  path: "codec/enc/webp_enc_simd.wasm",
  overrideGlobal: "__VAL_WEBP_SIMD_WASM_URL__",
};

/** Every binary the Studio's build may emit. See the top of this file. */
export const STATIC_WASM: readonly StaticWasm[] = [
  ROLLDOWN_WASM,
  WEBP_WASM,
  WEBP_SIMD_WASM,
];

/** The name a binary is served under, which is its name on disk. */
export function filenameOf(wasm: StaticWasm): string {
  return path.basename(wasm.path);
}

/** Where a binary is on disk. See {@link StaticWasm.resolveThrough}. */
export function locateWasm(fromDir: string, wasm: StaticWasm): string {
  let from = path.join(fromDir, "noop.js");
  for (const pkg of wasm.resolveThrough) {
    from = createRequire(from).resolve(`${pkg}/package.json`);
  }
  const file = path.join(path.dirname(from), wasm.path);
  if (!fs.existsSync(file)) {
    throw new Error(
      `${wasm.resolveThrough.at(-1)} does not have ${wasm.path} (looked in ` +
        `${file}). Either the package changed its layout or the binary is not ` +
        `installed; see packages/ui/build/staticWasm.ts.`,
    );
  }
  return file;
}

/** Where `@rolldown/browser`'s binary is on disk. */
export function findRolldownWasm(fromDir: string): string {
  return locateWasm(fromDir, ROLLDOWN_WASM);
}

/**
 * Rolldown's BROWSER WASI binding, beside the binary.
 *
 * `@rolldown/browser` ships two: `rolldown-binding.wasi.cjs` for Node, which
 * reads `process.cwd()` and imports `node:wasi` and `node:worker_threads` at
 * module scope, and `rolldown-binding.wasi-browser.js` for a tab.
 * `index.browser.mjs` picks the right one, but a shared chunk of the package
 * `require`s `../rolldown-binding.wasi.cjs` directly -- and `./parseAst` has no
 * `browser` condition at all -- so a browser build reaches the Node binding
 * whatever its target.
 */
export function findRolldownBrowserBinding(fromDir: string): string {
  const file = path.join(
    path.dirname(findRolldownWasm(fromDir)),
    "rolldown-binding.wasi-browser.js",
  );
  if (!fs.existsSync(file)) {
    throw new Error(
      `@rolldown/browser does not have dist/rolldown-binding.wasi-browser.js ` +
        `(looked in ${file}); see packages/ui/build/staticWasm.ts.`,
    );
  }
  return file;
}

/**
 * A string only the NODE binding contains, so a built chunk that has it is a
 * Studio whose builder cannot load. See {@link rolldownBrowserBindingPlugin}.
 */
export const NODE_BINDING_FINGERPRINT = "ERR_WORKER_INVALID_EXEC_ARGV";

/**
 * Point every import of rolldown's Node WASI binding at the browser one.
 *
 * Without it the Studio's builder chunk carries `rolldown-binding.wasi.cjs`,
 * and importing the builder REJECTS with `ReferenceError: process is not
 * defined` at `process.cwd()` -- before a single request, so a managed
 * project's publish committed and then never built, and the preload at mount
 * failed silently exactly as it is designed to. Shipped that way in
 * `@valbuild/ui@0.136.0`.
 *
 * The platform's builder tab found and fixed the same thing
 * (`browserWasiBinding` in valbuild/home's `app/vite.config.ts`), before the
 * builder moved into the Studio; this is that fix, where the Studio is built.
 *
 * A `resolveId` rather than an alias, because the import is RELATIVE
 * (`../rolldown-binding.wasi.cjs`, from inside a shared chunk) and an alias
 * replaces only the matched portion of a specifier.
 */
export function rolldownBrowserBindingPlugin({
  root,
}: {
  root: string;
}): Plugin {
  const browserBinding = findRolldownBrowserBinding(root);
  return {
    name: "val:rolldown-browser-binding",
    enforce: "pre",
    resolveId(source: string) {
      return source.endsWith("rolldown-binding.wasi.cjs")
        ? browserBinding
        : null;
    },
  };
}

/** The SHA-256 of a file, hex, which is how the static host addresses it. */
export function sha256Of(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

/** Where the binary with this digest is served from. */
export function wasmUrl(
  host: string,
  wasm: StaticWasm,
  sha256: string,
): string {
  return `${host.replace(/\/+$/, "")}/${wasm.name}/${sha256}/${filenameOf(wasm)}`;
}

/**
 * The expression Vite prints in place of the emitted asset's URL.
 *
 * A string of JavaScript, because `renderBuiltUrl`'s `runtime` form is how an
 * asset URL becomes something other than a constant.
 */
export function wasmUrlExpression(wasm: StaticWasm, url: string): string {
  return `(globalThis.${wasm.overrideGlobal} ?? ${JSON.stringify(url)})`;
}

/**
 * Every `.wasm` among these files, rather than the names on the list: the
 * emitted names are content-hashed, and a check on the known names would miss
 * the rename -- or the new binary -- this is here to notice.
 */
export function wasmAssetsIn(files: string[]): string[] {
  return files.filter((file) => file.endsWith(".wasm"));
}

/**
 * Which binaries an emitted asset's name says it is.
 *
 * Vite names an asset `[name]-[hash][extname]`, with an eight character hash.
 * The hash length is what keeps `webp_enc-` from matching
 * `webp_enc_simd-…` and any `a-` from matching `a-b-…`, and the name is only
 * a claim: `closeBundle` checks the asset's bytes hash to the binary's before
 * anything is deleted, so a name that matched the wrong one fails the build.
 */
export function binariesNamedBy(
  assetFileName: string,
  binaries: readonly StaticWasm[],
): StaticWasm[] {
  const base = path.basename(assetFileName);
  return binaries.filter((wasm) => {
    const stem = filenameOf(wasm).replace(/\.wasm$/, "");
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}-[A-Za-z0-9_-]{8}\\.wasm$`).test(base);
  });
}

/**
 * The Vite plugin: rewrite the URLs, then delete the assets they pointed at.
 *
 * Deleting is what keeps `fix-server-hack.js` from embedding them, and the
 * throws in `closeBundle` are the point of doing it here rather than in a shell
 * step. A dependency that renames its binary, adds one, or stops being loaded
 * the way this expects must fail this build -- a silently re-embedded binary
 * is corrupted on the way in, and has no symptom until someone's browser loads
 * it.
 */
export function staticWasmPlugin({
  root,
  host,
  outDir,
  binaries = STATIC_WASM,
}: {
  root: string;
  host: string;
  outDir: string;
  binaries?: readonly StaticWasm[];
}): Plugin {
  const located = binaries.map((wasm) => {
    const file = locateWasm(root, wasm);
    const sha256 = sha256Of(file);
    return {
      wasm,
      file,
      sha256,
      bytes: fs.statSync(file).size,
      url: wasmUrl(host, wasm, sha256),
    };
  });
  /** The one entry an emitted name stands for, or why it stands for none. */
  function locatedFor(assetFileName: string) {
    const named = binariesNamedBy(
      assetFileName,
      located.map(({ wasm }) => wasm),
    );
    return named.length === 1
      ? located.find(({ wasm }) => wasm === named[0])
      : undefined;
  }
  return {
    name: "val:static-wasm",
    config() {
      return {
        /*
         * `renderBuiltUrl` is read off the RESOLVED CONFIG, not off plugins.
         *
         * Vite documents it under `experimental`, and a plugin may declare an
         * `experimental` key -- but declaring it there is silently ignored: the
         * build then emits the asset, prints its own `/api/val/static/assets/…`
         * URL, and `closeBundle` below deletes the file the bundle is pointing
         * at. That is worse than not rewriting at all, and it is exactly what
         * happened first. The reference check in `closeBundle` is what turned
         * it from a 404 in a browser into a failed build.
         */
        experimental: {
          renderBuiltUrl(filename: string, { type }: { type: string }) {
            if (type === "asset" && filename.endsWith(".wasm")) {
              // An unknown binary is left alone here, and refused below with
              // a message that says what to do about it.
              const entry = locatedFor(filename);
              if (entry) {
                return { runtime: wasmUrlExpression(entry.wasm, entry.url) };
              }
            }
            return undefined;
          },
        },
      };
    },
    closeBundle() {
      const assetsDir = path.join(outDir, "assets");
      const emitted = fs.existsSync(assetsDir)
        ? wasmAssetsIn(fs.readdirSync(assetsDir))
        : [];

      /*
       * Every emitted binary is one on the list, by its BYTES.
       *
       * The name got it its URL in `renderBuiltUrl`; this is what makes that
       * safe. A name that matched the wrong entry, or two copies of a package
       * at different versions, would otherwise point the bundle at a digest
       * honestly computed from the wrong file.
       */
      for (const name of emitted) {
        const entry = locatedFor(name);
        if (!entry) {
          throw new Error(
            `The Studio build emitted ${name}, which is not a binary ` +
              `packages/ui/build/staticWasm.ts knows. Left alone it is ` +
              `embedded in both server bundles -- read as utf-8, which ` +
              `corrupts it. Add it to STATIC_WASM so it is served from the ` +
              `static host, or stop the SPA from importing whatever loads it.`,
          );
        }
        const actual = sha256Of(path.join(assetsDir, name));
        if (actual !== entry.sha256) {
          throw new Error(
            `The Studio build emitted ${name}, whose name says it is ` +
              `${entry.file}, but its bytes hash to ${actual} and that file's ` +
              `to ${entry.sha256}. The bundle would ask ${entry.url} for the ` +
              `wrong binary. Is a second version of ` +
              `${entry.wasm.resolveThrough.at(-1)} installed?`,
          );
        }
      }

      /*
       * ...and every binary on the list was emitted.
       *
       * One that was not is one the bundle does not load the way this
       * expects -- `new URL(..., import.meta.url)`, or a `?url` import -- so
       * its URL was not rewritten, and whatever does load it is asking
       * somewhere else.
       */
      for (const entry of located) {
        if (!emitted.some((name) => locatedFor(name) === entry)) {
          throw new Error(
            `The Studio build emitted no asset for ${entry.file}, so there ` +
              `was nothing to keep out of the server bundle and nothing ` +
              `rewritten to ${entry.url}. Either its package no longer loads ` +
              `it through new URL(..., import.meta.url), or the SPA no longer ` +
              `imports it. Check which before removing it from STATIC_WASM: ` +
              `an embedded binary is ${entry.bytes} bytes, corrupted, in every ` +
              `server bundle, and nothing else would report it.`,
          );
        }
      }

      /*
       * Nothing may still be pointing at what is about to be deleted.
       *
       * The rewrite above and this deletion are two halves of one change, and
       * they are configured in different places -- so a Vite that stops reading
       * `renderBuiltUrl` where this puts it leaves the bundle asking for a file
       * this then removes. The symptom is a 404 inside a loader, in a browser,
       * long after the build said it succeeded.
       *
       * Checked against the emitted NAME, which is content-hashed and therefore
       * unique, so this cannot pass by matching something else.
       */
      const chunks = fs
        .readdirSync(assetsDir)
        .filter((name) => name.endsWith(".js"))
        .map((name) => ({
          name,
          code: fs.readFileSync(path.join(assetsDir, name), "utf8"),
        }));
      for (const name of emitted) {
        const holdouts = chunks.filter((chunk) => chunk.code.includes(name));
        if (holdouts.length > 0) {
          throw new Error(
            `The Studio's bundle still asks for '${name}', which is a ` +
              `WebAssembly binary this build serves from the static host ` +
              `instead. Deleting it would ship a 404. Referenced by: ` +
              `${holdouts.map((chunk) => chunk.name).join(", ")}. ` +
              `Vite's renderBuiltUrl did not take effect -- see the config() ` +
              `hook in packages/ui/build/staticWasm.ts.`,
          );
        }
      }
      /*
       * ...and no chunk carries rolldown's NODE binding, which would make the
       * builder import reject in every tab. See rolldownBrowserBindingPlugin.
       */
      const withNodeBinding = chunks.filter((chunk) =>
        chunk.code.includes(NODE_BINDING_FINGERPRINT),
      );
      if (withNodeBinding.length > 0) {
        throw new Error(
          `The Studio's bundle carries rolldown's Node WASI binding ` +
            `(rolldown-binding.wasi.cjs) in ` +
            `${withNodeBinding.map((chunk) => chunk.name).join(", ")}. In a ` +
            `browser it throws "process is not defined" the moment the builder ` +
            `is imported, so no managed project could publish. Is ` +
            `rolldownBrowserBindingPlugin still in spa.vite.config.mts?`,
        );
      }
      for (const name of emitted) {
        fs.rmSync(path.join(assetsDir, name));
      }
      const manifest: StaticWasmManifest = {
        host,
        files: located.map(({ wasm, sha256, bytes, url }) => ({
          name: wasm.name,
          filename: filenameOf(wasm),
          resolveThrough: wasm.resolveThrough,
          path: wasm.path,
          sha256,
          bytes,
          url,
        })),
      };
      fs.writeFileSync(
        path.join(outDir, "..", MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  };
}

/**
 * What {@link MANIFEST_FILE} holds: every binary this build asks for, and how
 * to find its bytes. `scripts/uploadStaticWasm.mjs` and `verify-build.js` read
 * it, and nothing else, so neither can disagree with the build about the list.
 */
export type StaticWasmManifest = {
  host: string;
  files: {
    name: string;
    filename: string;
    resolveThrough: readonly string[];
    path: string;
    sha256: string;
    bytes: number;
    url: string;
  }[];
};
