/**
 * The build-time placeholders that `fix-server-hack.js` and
 * `fix-version-hack.js` substitute into the Vite output, and the helpers that
 * substitute them.
 *
 * These are plain string markers in the sources (`src/index.ts`,
 * `src/vite-index.ts`, `src/vite-server.ts`) that only get their real values
 * after bundling. That means the bundler has already had its way with them by
 * the time we look for them, and a bundler is free to re-print a string
 * literal however it likes.
 *
 * That is not hypothetical: Vite 8 (rolldown/oxc) constant-folds
 *
 *     `${VERSION ? `/${VERSION}` : ""}${VAL_APP_PATH}`
 *
 * in `vite-server.ts` down to a single template literal and escapes every `$`
 * while printing it, so the output reads
 *
 *     `/\$\$BUILD_\$\$REPLACE_WITH_VERSION\$\$/app`
 *
 * A plain `String.replace("$$BUILD_$$REPLACE_WITH_VERSION$$", version)` finds
 * nothing there, and the shipped server then compares the request path against
 * a literal placeholder instead of `/0.108.0/app`. Nothing throws: the request
 * for the app bundle just falls through to the SPA fallback and the browser
 * refuses the HTML it gets back with "Expected a JavaScript-or-Wasm module
 * script but the server responded with a MIME type of ''".
 *
 * So: match the placeholders escape-tolerantly, replace every occurrence, and
 * make the build fail loudly if any marker survives.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

const VERSION_PLACEHOLDER = "$$BUILD_$$REPLACE_WITH_VERSION$$";
const RECORD_PLACEHOLDER = "$$BUILD_$$REPLACE_WITH_RECORD$$";

/**
 * The part of a placeholder that survives any amount of `$` escaping, so it is
 * what we scan for when asserting that a substitution actually happened.
 */
const VERSION_MARKER = "REPLACE_WITH_VERSION";
const RECORD_MARKER = "REPLACE_WITH_RECORD";

/** `$$BUILD_$$REPLACE_WITH_VERSION$$`, with each `$` optionally backslash-escaped. */
const VERSION_PLACEHOLDER_PATTERN =
  /(?:\\?\$){2}BUILD_(?:\\?\$){2}REPLACE_WITH_VERSION(?:\\?\$){2}/g;
/** `$$BUILD_$$REPLACE_WITH_RECORD$$`, with each `$` optionally backslash-escaped. */
const RECORD_PLACEHOLDER_PATTERN =
  /(?:\\?\$){2}BUILD_(?:\\?\$){2}REPLACE_WITH_RECORD(?:\\?\$){2}/g;

/**
 * Replace every occurrence of `pattern` in `content` with `value`.
 *
 * `value` is inserted verbatim - a `$` in it is never treated as a
 * replacement pattern (`$&`, `$1`, ...).
 *
 * @param {string} content
 * @param {RegExp} pattern
 * @param {string} value
 * @returns {{ content: string, count: number }}
 */
function replaceAllOccurrences(content, pattern, value) {
  let count = 0;
  const replaced = content.replace(new RegExp(pattern.source, "g"), () => {
    count++;
    return value;
  });
  return { content: replaced, count };
}

/**
 * @param {string} content
 * @param {string} version
 * @returns {{ content: string, count: number }}
 */
function replaceVersionPlaceholder(content, version) {
  return replaceAllOccurrences(content, VERSION_PLACEHOLDER_PATTERN, version);
}

/**
 * @param {string} content
 * @param {string} record
 * @returns {{ content: string, count: number }}
 */
function replaceRecordPlaceholder(content, record) {
  return replaceAllOccurrences(content, RECORD_PLACEHOLDER_PATTERN, record);
}

/**
 * Throw if a placeholder marker survived substitution.
 *
 * This is the check that turns "the published package silently serves HTML
 * where the app bundle should be" into a failed build.
 *
 * @param {string} content
 * @param {string} filePath
 * @param {string[]} [markers]
 */
function assertNoPlaceholdersLeft(
  content,
  filePath,
  markers = [VERSION_MARKER, RECORD_MARKER],
) {
  for (const marker of markers) {
    const index = content.indexOf(marker);
    if (index !== -1) {
      throw new Error(
        `Build placeholder '${marker}' was not replaced in ${filePath}: ` +
          `${JSON.stringify(content.slice(Math.max(0, index - 40), index + 40))}. ` +
          `The bundler most likely re-printed the placeholder in a form ` +
          `buildPlaceholders.js does not recognise - see the comment at the ` +
          `top of that file.`,
      );
    }
  }
}

module.exports = {
  VERSION_PLACEHOLDER,
  RECORD_PLACEHOLDER,
  VERSION_MARKER,
  RECORD_MARKER,
  replaceVersionPlaceholder,
  replaceRecordPlaceholder,
  assertNoPlaceholdersLeft,
};
