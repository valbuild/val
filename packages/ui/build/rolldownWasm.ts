/**
 * Keeping rolldown's 10.9 MB of WebAssembly out of the Studio's bundle, and
 * pointing the bundle at where it really lives.
 *
 * The Studio builds a site in the tab, so the SPA dynamically imports
 * `@valbuild/tanstack-build`, which imports `@rolldown/browser`. Vite sees
 * `new URL('./rolldown-binding.wasm32-wasi.wasm', import.meta.url)` in
 * rolldown's WASI loader, emits the binary as an asset, and rewrites the URL to
 * point at it. That asset is where the trouble is.
 *
 * `/api/val/static` is NOT a directory. `createUIRequestHandler` answers it out
 * of a `Record<string, string>` of base64 that `fix-server-hack.js` substitutes
 * into both server bundles at build time, and it builds that record with
 * `fs.readFileSync(file, "utf-8")`. So shipping the binary that way does two
 * things, neither of which anything would have noticed:
 *
 * - It CORRUPTS it. Read as utf-8 and written back, 10,845,151 bytes come out
 *   12,811,857 bytes and unequal.
 * - Its base64 is 14,460,204 characters, as a string literal in each of the two
 *   server bundles -- and `@valbuild/tanstack-build`'s `wire.ts` DECLARES
 *   `@valbuild/ui` as a project dependency precisely so it lands in that
 *   project's vendor layer, so every project's layer would grow by that much.
 *
 * So the binary is served from `DEFAULT_STATIC_HOST` instead -- the content
 * service's `/v1/static`, which answers with a redirect to a public bucket --
 * and this module is what makes the built bundle ask for it there.
 *
 * ## Addressed by content, not by version
 *
 * The URL is `<host>/rolldown/<sha256 of the bytes>/<filename>`, where the
 * "host" is a base URL with a path (`https://content.val.build/v1/static`). A version
 * number would have to be kept in step with the release by hand; a hash cannot
 * be got wrong, because the URL the bundle points at IS the digest of the bytes
 * that bundle needs. Uploading is therefore "put it if it is absent", and a
 * `@valbuild/ui` build can never ask for a rolldown other than the one it was
 * built against.
 *
 * ## The runtime escape hatch
 *
 * What is printed is
 * `globalThis.__VAL_ROLLDOWN_WASM_URL__ ?? "<the content-addressed URL>"`, so a
 * deployment that must not reach the static host -- an air-gapped install, a
 * mirror, a test -- sets one global before the Studio loads the builder and
 * needs no rebuild.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** The one asset this module is about. */
export const WASM_FILENAME = "rolldown-binding.wasm32-wasi.wasm";

/**
 * Where the binary is served from, unless `VAL_STATIC_HOST` says otherwise.
 *
 * A literal rather than an import of `DEFAULT_STATIC_HOST` from
 * `@valbuild/core`, which is the real source of truth: Vite loads a config file
 * by bundling it to ESM, and core's built entry is CommonJS, so the named
 * import fails at config load with "Named export not found". Kept honest by
 * `build/rolldownWasm.test.ts`, which asserts the two are the same string.
 */
export const DEFAULT_STATIC_HOST = "https://content.val.build/v1/static";

/** Where the manifest the release uploader reads is written. */
export const MANIFEST_FILE = "rolldown-wasm.json";

/**
 * The global a deployment sets to serve the binary from somewhere else.
 *
 * Read at the moment rolldown's loader module is evaluated, which is inside the
 * chunk the Studio dynamically imports -- so setting it any time before the
 * builder is loaded is early enough.
 */
export const RUNTIME_OVERRIDE_GLOBAL = "__VAL_ROLLDOWN_WASM_URL__";

/**
 * Where `@rolldown/browser`'s binary is on disk, resolved THROUGH
 * `@valbuild/tanstack-build`.
 *
 * Through it rather than from here, because that package is the one that
 * declares the dependency. Resolving it from `@valbuild/ui` would find whatever
 * a hoist happened to put in reach, which is the version skew this whole file
 * exists to make impossible.
 */
export function findRolldownWasm(fromDir: string): string {
  const require = createRequire(path.join(fromDir, "noop.js"));
  const builderManifest =
    require.resolve("@valbuild/tanstack-build/package.json");
  const fromBuilder = createRequire(builderManifest);
  const loader = fromBuilder.resolve("@rolldown/browser/package.json");
  const file = path.join(path.dirname(loader), "dist", WASM_FILENAME);
  if (!fs.existsSync(file)) {
    throw new Error(
      `@rolldown/browser does not have dist/${WASM_FILENAME} (looked in ${file}). ` +
        `Either the package changed its layout or the binary is not installed; ` +
        `see packages/ui/build/rolldownWasm.ts.`,
    );
  }
  return file;
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
        `(looked in ${file}); see packages/ui/build/rolldownWasm.ts.`,
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
export function wasmUrl(host: string, sha256: string): string {
  return `${host.replace(/\/+$/, "")}/rolldown/${sha256}/${WASM_FILENAME}`;
}

/**
 * The expression Vite prints in place of the emitted asset's URL.
 *
 * A string of JavaScript, because `renderBuiltUrl`'s `runtime` form is how an
 * asset URL becomes something other than a constant.
 */
export function wasmUrlExpression(url: string): string {
  return `(globalThis.${RUNTIME_OVERRIDE_GLOBAL} ?? ${JSON.stringify(url)})`;
}

/**
 * Which emitted files this build must not keep.
 *
 * Every `.wasm` rather than the one name, because the name is content-hashed
 * and a check on the literal filename would miss the rename this is here to
 * notice.
 *
 * It does NOT follow that a second binary is handled. The URL addresses ONE
 * digest, and `renderBuiltUrl` rewrites every `.wasm` to it — so a build that
 * emitted two would point the second at the first's bytes and then delete it,
 * which is a wrong answer rather than a missing one. `closeBundle` refuses that
 * case outright; this function only says which files are in it.
 */
export function wasmAssetsIn(files: string[]): string[] {
  return files.filter((file) => file.endsWith(".wasm"));
}

/**
 * The Vite plugin: rewrite the URL, then delete the asset it pointed at.
 *
 * Deleting is what keeps `fix-server-hack.js` from embedding it, and the throw
 * when there was nothing to delete is the point of doing it here rather than in
 * a shell step. A rolldown release that renames the binary, or a Vite that stops
 * emitting it as an asset, must fail this build -- silently re-embedding 14.5 MB
 * is the failure mode this replaces, and it has no symptom until a project's
 * vendor layer will not fit.
 */
export function rolldownWasmPlugin({
  root,
  host,
  outDir,
}: {
  root: string;
  host: string;
  outDir: string;
}): Plugin {
  const file = findRolldownWasm(root);
  const sha256 = sha256Of(file);
  const url = wasmUrl(host, sha256);
  const bytes = fs.statSync(file).size;
  return {
    name: "val:rolldown-wasm",
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
              return { runtime: wasmUrlExpression(url) };
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
      if (emitted.length === 0) {
        throw new Error(
          `The Studio build emitted no .wasm asset, so there was nothing to ` +
            `keep out of the server bundle. Either @rolldown/browser no longer ` +
            `loads its binary through new URL(..., import.meta.url), or the SPA ` +
            `no longer imports @valbuild/tanstack-build. Check before removing ` +
            `this: an embedded binary is ${bytes} bytes of base64 in every ` +
            `server bundle and every project's vendor layer, and nothing else ` +
            `would report it.`,
        );
      }
      /*
       * One binary, or none of this is true.
       *
       * The rewrite sends every `.wasm` to ONE content-addressed URL, so a
       * build that emitted two would serve the first's bytes for both and then
       * delete the second — silently, and with a digest that is honestly
       * computed and describes the wrong file. There is no correct behaviour
       * available here, so this refuses instead of choosing one.
       */
      if (emitted.length > 1) {
        throw new Error(
          `The Studio build emitted more than one .wasm asset ` +
            `(${emitted.join(", ")}), and this serves exactly one from ` +
            `${url}. Every one of them would be rewritten to that single URL, ` +
            `so the extra binaries would resolve to the wrong bytes. Give each ` +
            `its own content-addressed URL before removing this check.`,
        );
      }

      /*
       * Nothing may still be pointing at what is about to be deleted.
       *
       * The rewrite above and this deletion are two halves of one change, and
       * they are configured in different places -- so a Vite that stops reading
       * `renderBuiltUrl` where this puts it leaves the bundle asking for a file
       * this then removes. The symptom is a 404 inside rolldown's loader, in a
       * browser, on the first publish, long after the build said it succeeded.
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
            `The Studio's bundle still asks for '${name}', which is the ` +
              `WebAssembly binary this build serves from ${url} instead. ` +
              `Deleting it would ship a 404. Referenced by: ` +
              `${holdouts.map((chunk) => chunk.name).join(", ")}. ` +
              `Vite's renderBuiltUrl did not take effect -- see the config() ` +
              `hook in packages/ui/build/rolldownWasm.ts.`,
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
      fs.writeFileSync(
        path.join(outDir, "..", MANIFEST_FILE),
        `${JSON.stringify({ filename: WASM_FILENAME, sha256, bytes, host, url }, null, 2)}\n`,
      );
    },
  };
}
