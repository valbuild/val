/**
 * Post-build check: load the packaged server bundle and ask it for the files
 * the Studio actually requests.
 *
 * `fix-server-hack.js` and `fix-version-hack.js` patch strings into bundler
 * output, so they are only ever as correct as the shape that output happens to
 * have. When that shape changed under them (Vite 8 re-printing a folded
 * template literal with escaped `$`), nothing failed: the version placeholder
 * survived into the published package, `/api/val/static/<version>/app` stopped
 * matching, and every Studio served the SPA fallback HTML in place of the app
 * bundle - "Failed to load module script: ... MIME type of ''".
 *
 * Asserting on the built artifact is the only check that does not care how the
 * substitution is implemented or how the bundler prints it.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");

const VERSION = packageJson.version;
const APP_PATH = `/${VERSION}/app`;
const CSS_PATH = `/${VERSION}/spa/index.css`;

/**
 * @param {string} name
 * @param {boolean} condition
 * @param {string} details
 */
function check(name, condition, details) {
  if (!condition) {
    throw new Error(`Val UI build verification failed: ${name} (${details})`);
  }
  console.log(`Verified: ${name}`);
}

async function main() {
  const bundlePath = path.join(
    __dirname,
    "server/dist/valbuild-ui-server.cjs.js",
  );
  const { createUIRequestHandler } = require(bundlePath);
  const handler = createUIRequestHandler();

  const app = await handler(
    APP_PATH,
    `http://localhost/api/val/static${APP_PATH}`,
  );
  check(
    `${APP_PATH} is served as JavaScript`,
    app.status === 200 &&
      app.headers?.["Content-Type"] === "application/javascript",
    `got status ${app.status} and Content-Type ${JSON.stringify(
      app.headers?.["Content-Type"],
    )}`,
  );
  check(
    `${APP_PATH} has a body`,
    typeof app.body === "string" && app.body.length > 0,
    `body was ${typeof app.body}`,
  );

  const css = await handler(
    CSS_PATH,
    `http://localhost/api/val/static${CSS_PATH}`,
  );
  check(
    `${CSS_PATH} is served as CSS`,
    css.status === 200 && css.headers?.["Content-Type"] === "text/css",
    `got status ${css.status} and Content-Type ${JSON.stringify(
      css.headers?.["Content-Type"],
    )}`,
  );

  const index = await handler("/", "http://localhost/api/val/static/");
  check(
    "unknown paths fall back to the index page as HTML",
    index.status === 200 &&
      typeof index.headers?.["Content-Type"] === "string" &&
      index.headers["Content-Type"].startsWith("text/html"),
    `got status ${index.status} and Content-Type ${JSON.stringify(
      index.headers?.["Content-Type"],
    )}`,
  );
  check(
    "the index page references the built app bundle",
    typeof index.body === "string" &&
      index.body.includes("/api/val/static/assets/index-"),
    "the index page did not reference /api/val/static/assets/index-*",
  );

  await checkChunkImports(handler, app.body);

  await checkRolldownWasm();
}

/**
 * Every chunk the Studio's main bundle imports, fetched the way a browser
 * would fetch it: relative to `/{VERSION}/app`, which is where the main chunk
 * is SERVED, not `/assets/`, which is where it was emitted.
 *
 * `@valbuild/ui@0.136.0` shipped with its main chunk statically importing
 * `./__vite-browser-external-….js`. That resolved to `/{VERSION}/…`, which the
 * handler did not know, so it answered the SPA's HTML fallback -- and a
 * browser refuses an HTML module script, so the Studio did not boot at all.
 * Every check above passed, because every one of them asks for a path by its
 * own name. This asks for the paths the bundle itself asks for, and follows
 * them: the builder chunk is a dynamic import that has imports of its own.
 */
async function checkChunkImports(handler, mainBody) {
  const base = `http://localhost/api/val/static/${VERSION}/app`;
  const seen = new Set();
  const pending = [{ from: `${APP_PATH}`, url: base, body: mainBody }];
  /*
   * Backticks too: Vite 8 prints `import(\`./chunk.js\`)`, and a check that
   * only knew quotes followed the static import and never reached the builder.
   *
   * Only names shaped like an EMITTED chunk, `[name]-[hash].js`. The builder
   * chunk carries rolldown's runtime as source text, and that text has a JSDoc
   * `@import … from './runtime-extra-dev-common.js'` in it -- a string, not an
   * import, and reading it as one fails the build over nothing.
   */
  const relative =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'`](\.\.?\/[^"'`/]+-[A-Za-z0-9_-]{8}\.js)["'`]/g;
  while (pending.length > 0) {
    const { from, url, body } = pending.pop();
    for (const match of body.matchAll(relative)) {
      const resolved = new URL(match[1], url);
      const path = resolved.pathname.replace(/^\/api\/val\/static/, "");
      if (seen.has(path)) continue;
      seen.add(path);
      const res = await handler(path, resolved.href);
      check(
        `${from} can import ${match[1]}`,
        res.status === 200 &&
          res.headers?.["Content-Type"] === "application/javascript" &&
          typeof res.body === "string" &&
          res.body.length > 0,
        `${resolved.pathname} answered ${res.status} with Content-Type ` +
          `${JSON.stringify(res.headers?.["Content-Type"])}; a browser refuses ` +
          `that as a module script, and the Studio does not start`,
      );
      pending.push({ from: path, url: resolved.href, body: res.body });
    }
  }
  check(
    "the main bundle's imports were followed",
    seen.size > 0,
    "no relative import was found in the main bundle, so this check tested " +
      "nothing -- if the Studio really is one chunk again, remove it",
  );
}

/**
 * The bundler's WebAssembly is served from elsewhere, and this proves it twice.
 *
 * The binary is 10.9 MB and must not go through the base64 record: read as
 * utf-8 it does not round-trip, and its base64 is 14.5 MB of string literal in
 * each server bundle -- which `wire.ts` then carries into every project's
 * vendor layer, because it declares `@valbuild/ui` as a project dependency.
 * See `build/rolldownWasm.ts`.
 *
 * Asserted on the BUILT artifact rather than on the build step, for the same
 * reason everything else here is: the substitution is a string replacement over
 * bundler output, and it is only ever as correct as the shape that output
 * happens to have.
 */
async function checkRolldownWasm() {
  const manifestPath = path.join(__dirname, "server", "rolldown-wasm.json");
  check(
    "the rolldown wasm manifest was written",
    fs.existsSync(manifestPath),
    `${manifestPath} does not exist; the SPA build's val:rolldown-wasm plugin did not run`,
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  check(
    "the manifest names a sha256 and a URL that carries it",
    /^[0-9a-f]{64}$/.test(manifest.sha256 ?? "") &&
      typeof manifest.url === "string" &&
      manifest.url.includes(manifest.sha256),
    `sha256 was ${JSON.stringify(manifest.sha256)} and url ${JSON.stringify(manifest.url)}`,
  );

  /*
   * ...and that URL is under the host this build was meant to point at.
   *
   * `@valbuild/core` is the source of truth; `build/rolldownWasm.ts` has to
   * keep a copy of the literal (Vite cannot import core's CommonJS entry into
   * a config), and this is where a copy that drifted would show up as what it
   * is -- a Studio asking a host that does not serve the binary.
   */
  const { DEFAULT_STATIC_HOST } = require("@valbuild/core");
  const host = (process.env.VAL_STATIC_HOST || DEFAULT_STATIC_HOST).replace(
    /\/+$/,
    "",
  );
  const expectedUrl = `${host}/rolldown/${manifest.sha256}/${manifest.filename}`;
  check(
    "the binary is addressed under the static host @valbuild/core declares",
    manifest.url === expectedUrl,
    `the manifest says ${JSON.stringify(manifest.url)}, and ${
      process.env.VAL_STATIC_HOST ? "VAL_STATIC_HOST" : "DEFAULT_STATIC_HOST"
    } makes it ${JSON.stringify(expectedUrl)}`,
  );

  // What `fix-server-hack.js` base64s into the server bundle. Checked here
  // rather than through the handler because the record is keyed by the asset's
  // hashed name, which nothing outside the build knows -- and because a request
  // for a name that is not in the record falls through to the SPA index page,
  // so "not served" and "served the wrong thing" look identical from outside.
  const assetsDir = path.join(__dirname, "server", ".tmp", "assets");
  const assets = fs.readdirSync(assetsDir);
  check(
    "no .wasm reached the files that get embedded",
    assets.every((name) => !name.endsWith(".wasm")),
    `${assets.filter((name) => name.endsWith(".wasm")).join(", ")} is in the ` +
      `directory fix-server-hack.js base64s, so it is in both server bundles ` +
      `and in every project's vendor layer`,
  );
  const spa = assets
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(assetsDir, name), "utf-8"));
  check(
    "the Studio asks for the binary at the static host",
    spa.some((code) => code.includes(manifest.url)),
    `no built chunk mentions ${manifest.url}, so the Studio does not know ` +
      `where the binary is`,
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
