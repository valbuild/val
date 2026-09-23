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

  await checkRolldownWasm();
}

/**
 * The bundler's WebAssembly is served from elsewhere, and this proves it twice.
 *
 * The binary is 10.9 MB and must not go through the base64 record: read as
 * utf-8 it does not round-trip, and its base64 is 14.5 MB of string literal in
 * each server bundle -- which `wire.ts` then carries into every project's
 * vendor layer, because it declares `@valbuild/ui` as a project dependency.
 * See `build/rolldownWasm.mjs`.
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
