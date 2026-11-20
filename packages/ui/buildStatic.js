/**
 * The Studio as plain files, for a host that serves them itself.
 *
 * Every other host gets the Studio from `@valbuild/ui/server`, which carries
 * the whole of it base64-embedded in one string (`fix-server-hack.js`). That
 * costs a server that loads it roughly 80-100 MB of heap -- the embedded text,
 * the parsed record and the decoded files -- which inside a 128 MB Cloudflare
 * isolate leaves too little for the site itself, and the isolate is killed
 * for exceeding its memory. A host that can serve static files (Val Build's
 * platform, from R2) takes the files from here instead, and builds its server
 * without the embedded copy.
 *
 * Written next to the server bundle by the same build, from the same output,
 * so the two can never be different Studios:
 *
 *   static/files/<path>   each file, with the version substituted as in the
 *                         embedded record; binary files byte for byte, which
 *                         the embedded record cannot do (it reads them as
 *                         utf-8)
 *   static/manifest.json  what each file is (sha256, size, content type), and
 *                         which REQUEST path serves which file (`routes`) --
 *                         the same rules `src/vite-server.ts` answers by, so a
 *                         host follows the map and needs no rules of its own
 *
 * `verify-build.js` checks every route against the embedded handler.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  replaceVersionPlaceholder,
  assertNoPlaceholdersLeft,
} = require("./buildPlaceholders");

/** The manifest's own shape. A host reads it, so a change here is a contract change. */
const MANIFEST_FORMAT = 1;

const IMMUTABLE = "public, max-age=31536000, immutable";
/** What the embedded handler sends with its index-page fallback. */
const FALLBACK_CACHE_CONTROL = "max-age=90";

/** Content types by extension; `src/vite-server.ts` agrees for every text type. */
const CONTENT_TYPES = {
  js: "application/javascript",
  mjs: "application/javascript",
  jsx: "application/javascript",
  css: "text/css",
  json: "application/json",
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  map: "application/json",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** Text, so the version placeholder can be in it and is substituted. */
const TEXT_EXTENSIONS = new Set([
  "js",
  "mjs",
  "jsx",
  "css",
  "json",
  "html",
  "svg",
  "map",
  "txt",
]);

/** @param {string} file */
function extensionOf(file) {
  const base = file.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

/** @param {string} file */
function contentTypeOf(file) {
  return CONTENT_TYPES[extensionOf(file)] || "application/octet-stream";
}

/**
 * Every file under `dir`, as `/`-rooted posix paths relative to it.
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
function walk(dir, prefix = "") {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = `${prefix}/${name}`;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Which request path serves which file, relative to the static route
 * (`/api/val/static`). The rules are `src/vite-server.ts`'s, spelled out:
 *
 * - `/{version}/app` is the main chunk, and `/{version}/spa/index.css` the
 *   stylesheet: what `ValApp` and the Studio ask for.
 * - `/{version}/<name>` is `/assets/<name>`: the main chunk is SERVED at
 *   `/{version}/app`, so its relative imports resolve there (`siblingOfApp`).
 * - Every file is also served at its own path.
 * - Anything else is the index page (`fallback`), as a single-page app.
 *
 * Left out: the unversioned `/app` and `/spa/index.css`, which the embedded
 * handler answers with a redirect to the current file and nothing asks for
 * any more. A host that only follows this map answers them with the fallback.
 *
 * @param {string} version
 * @param {string[]} files
 * @param {string} main
 * @param {string} css
 */
function routesOf(version, files, main, css) {
  /** @type {Record<string, { file: string, cacheControl: string }>} */
  const routes = {};
  const route = (at, file) => {
    routes[at] = { file, cacheControl: IMMUTABLE };
  };
  for (const file of files) route(file, file);
  for (const file of files) {
    const match = /^\/assets\/([^/]+)$/.exec(file);
    if (match) route(`/${version}/${match[1]}`, file);
  }
  // Last, so a sibling that happens to be called `app` cannot shadow them.
  route(`/${version}/app`, main);
  route(`/${version}/spa/index.css`, css);
  return routes;
}

/**
 * Write `outDir/files/...` and `outDir/manifest.json` from the SPA build in
 * `inputDir`. Returns the manifest.
 *
 * @param {{ inputDir: string, outDir: string, version: string }} options
 */
function writeStatic({ inputDir, outDir, version }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const filesDir = path.join(outDir, "files");
  const files = walk(inputDir);

  /** @type {Record<string, { sha256: string, size: number, contentType: string }>} */
  const described = {};
  for (const file of files) {
    let bytes = fs.readFileSync(path.join(inputDir, file));
    if (TEXT_EXTENSIONS.has(extensionOf(file))) {
      const { content } = replaceVersionPlaceholder(
        bytes.toString("utf-8"),
        version,
      );
      assertNoPlaceholdersLeft(content, file);
      bytes = Buffer.from(content, "utf-8");
    }
    const target = path.join(filesDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    described[file] = {
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      contentType: contentTypeOf(file),
    };
  }

  const mains = files.filter((file) =>
    /^\/assets\/index-[^/]*\.js$/.test(file),
  );
  const csses = files.filter((file) => file.endsWith(".css"));
  if (mains.length !== 1) {
    throw new Error(
      `Expected exactly one main chunk (/assets/index-*.js) in ${inputDir}, found ${JSON.stringify(mains)}`,
    );
  }
  if (csses.length !== 1) {
    throw new Error(
      `Expected exactly one stylesheet in ${inputDir}, found ${JSON.stringify(csses)}`,
    );
  }
  if (!described["/index.html"]) {
    throw new Error(`No /index.html in ${inputDir}`);
  }

  const manifest = {
    format: MANIFEST_FORMAT,
    version,
    files: described,
    routes: routesOf(version, files, mains[0], csses[0]),
    fallback: { file: "/index.html", cacheControl: FALLBACK_CACHE_CONTROL },
  };
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

module.exports = {
  MANIFEST_FORMAT,
  IMMUTABLE,
  FALLBACK_CACHE_CONTROL,
  contentTypeOf,
  routesOf,
  writeStatic,
};
