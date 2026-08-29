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
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
