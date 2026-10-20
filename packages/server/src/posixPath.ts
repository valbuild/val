/**
 * `path.posix`, for the four functions the request handlers use.
 *
 * Node's `path` cannot be bundled for a browser, and the request handlers run
 * in one for the demo (`@valbuild/server/browser`). These are Node's own posix
 * algorithms, and `posixPath.test.ts` checks them against `path.posix` itself,
 * so the two cannot differ quietly. Module paths are always posix -- `/app/
 * page.val.ts` on Windows too -- so nothing here needs the platform's `path`.
 */

/** Resolves `.` and `..` segments, as Node's `normalizeString` does. */
function normalizeSegments(path: string, allowAboveRoot: boolean): string {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (code === 47 /* / */) {
      break;
    } else {
      code = 47;
    }
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1) {
        // A repeated slash or a `.` segment: nothing to add.
      } else if (dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== 46 /* . */ ||
          res.charCodeAt(res.length - 2) !== 46
        ) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf("/");
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? "/.." : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += "/" + path.slice(lastSlash + 1, i);
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function normalize(path: string): string {
  if (path.length === 0) return ".";
  const isAbsolute = path.charCodeAt(0) === 47;
  const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
  let normalized = normalizeSegments(path, !isAbsolute);
  if (normalized.length === 0) {
    if (isAbsolute) return "/";
    return trailingSeparator ? "./" : ".";
  }
  if (trailingSeparator) normalized += "/";
  return isAbsolute ? `/${normalized}` : normalized;
}

function join(...paths: string[]): string {
  const joined = paths.filter((path) => path.length > 0).join("/");
  return joined.length === 0 ? "." : normalize(joined);
}

function dirname(path: string): string {
  if (path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}

/**
 * Node resolves both sides against `process.cwd()` first. When both are
 * relative the cwd is a common prefix and drops out of the answer, so a root
 * stands in for it; when only one is, the answer depends on a directory a
 * browser does not have, and it is refused rather than guessed.
 */
function resolveBoth(from: string, to: string): [string, string] {
  const fromAbsolute = from.charCodeAt(0) === 47;
  const toAbsolute = to.charCodeAt(0) === 47;
  if (fromAbsolute !== toAbsolute) {
    throw new Error(
      `posixPath.relative needs two absolute or two relative paths, got '${from}' and '${to}'.`,
    );
  }
  const root = (path: string) =>
    `/${normalizeSegments(fromAbsolute ? path : `/${path}`, false)}`;
  return [root(from), root(to)];
}

function relative(from: string, to: string): string {
  if (from === to) return "";
  [from, to] = resolveBoth(from, to);
  if (from === to) return "";
  const fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  const toStart = 1;
  const toLen = to.length - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) break;
    else if (fromCode === 47) lastCommonSep = i;
  }
  if (i === length) {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === 47) {
        return to.slice(toStart + i + 1);
      }
      if (i === 0) {
        return to.slice(toStart + i);
      }
    } else if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === 47) {
        lastCommonSep = i;
      } else if (i === 0) {
        lastCommonSep = 0;
      }
    }
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === 47) {
      out += out.length === 0 ? ".." : "/..";
    }
  }
  return `${out}${to.slice(toStart + lastCommonSep)}`;
}

export const posixPath = { normalize, join, dirname, relative };
