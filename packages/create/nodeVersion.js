"use strict";

/**
 * Is this Node too old to run `@valbuild/create`?
 *
 * Plain CommonJS with no dependencies, and deliberately outside `src/`: the
 * bundle built from `src/` pulls in ESM-only packages at its first line, so
 * anything that lives there is loaded too late to explain why loading it
 * failed. `bin.js` requires this first instead.
 *
 * The range comes from `engines.node` in package.json rather than being
 * repeated here, so there is one answer to what Node we support. That means
 * parsing a range, which this does only for the two clause forms we actually
 * write (`^x.y.z` and `>=x.y.z`, joined by `||`). Anything it cannot parse
 * fails OPEN — a range shape this does not understand must not stop someone
 * from creating a project.
 */

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseVersion(version) {
  // Anchored at both ends, so anything this does not fully understand is null
  // rather than its leading digits. Unanchored, `>=22.13.0 <23` read as
  // `>=22.13.0` - the upper bound silently dropped - and `20.11.0garbage` read
  // as a version. A prerelease suffix is the one thing allowed through, and it
  // is ignored: a prerelease of a supported major is close enough to
  // supported, and refusing it is worse than trying.
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * @param {{ major: number, minor: number, patch: number }} a
 * @param {{ major: number, minor: number, patch: number }} b
 * @returns {number}
 */
function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * @param {{ major: number, minor: number, patch: number }} version
 * @param {string} clause
 * @returns {boolean | null} null when the clause form is not understood
 */
function satisfiesClause(version, clause) {
  const trimmed = clause.trim();
  const caret = /^\^\s*(.+)$/.exec(trimmed);
  if (caret) {
    const min = parseVersion(caret[1]);
    if (!min) {
      return null;
    }
    return version.major === min.major && compareVersions(version, min) >= 0;
  }
  const atLeast = /^>=\s*(.+)$/.exec(trimmed);
  if (atLeast) {
    const min = parseVersion(atLeast[1]);
    if (!min) {
      return null;
    }
    return compareVersions(version, min) >= 0;
  }
  return null;
}

/**
 * True only when the range was understood AND this version fails all of it, so
 * an unparseable range or version is never reported as unsupported.
 *
 * @param {string} version e.g. process.versions.node
 * @param {string} range e.g. "^22.13.0 || >=23.5.0"
 * @returns {boolean}
 */
function isUnsupportedNodeVersion(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return false;
  }
  const clauses = range.split("||");
  let understoodAny = false;
  for (const clause of clauses) {
    const satisfied = satisfiesClause(parsed, clause);
    if (satisfied === null) {
      continue;
    }
    understoodAny = true;
    if (satisfied) {
      return false;
    }
  }
  return understoodAny;
}

module.exports = { isUnsupportedNodeVersion };
