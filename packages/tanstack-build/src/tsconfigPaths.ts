// tsconfig `paths` aliases: `import { Button } from '@/components/Button'`.
//
// Almost every real Start app writes these, and every shadcn-based one does.
// Before this, such an import resolved to nothing: rolldown logged "Module not
// found, treating it as an external dependency", the build *succeeded*, and the
// component silently vanished from the bundle. The publish gate caught it as
// PLATFORM401 -- but named it a missing dependency, which is the wrong diagnosis and
// sends you to install a package that does not exist.
//
// A note on why this is hand-written rather than delegated. The obvious
// candidate is oxc_resolver (VoidZero's, the Oxc project) -- rolldown uses it
// internally and exposes it as the top-level `tsconfig` option, and it ships a
// wasm32-wasi binding, so it would even run in a browser. It is the wrong shape
// for this builder: it resolves against a *filesystem*, and this builder
// resolves against an in-memory `files` record. There is no filesystem in the
// tab, and bare specifiers here must land on prebuilt vendor chunks rather than
// walking node_modules -- which is most of what a general resolver is for. So
// we borrow the algorithm, which is small and well specified, and not the
// package. `tsconfig.json` is already in `files`; the map is data we hold.
import { dirname, resolve } from "./paths";

/**
 * JSON with comments and trailing commas, which is what tsconfig.json is.
 *
 * Written as a scanner rather than a regex on purpose: `"url": "https://x"`
 * contains `//`, and a regex that strips comments without tracking string state
 * truncates the file there and throws a parse error pointing at the wrong line.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      // Copy the whole string literal, escapes included, untouched.
      out += ch;
      i++;
      while (i < text.length) {
        const c = text[i]!;
        out += c;
        i++;
        if (c === "\\") {
          if (i < text.length) out += text[i++];
          continue;
        }
        if (c === '"') break;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Trailing commas, now that every remaining comma is structural.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

interface TsConfig {
  extends?: string;
  compilerOptions?: { baseUrl?: string; paths?: Record<string, Array<string>> };
}

/** One `paths` entry, pre-split on its wildcard. */
interface Pattern {
  prefix: string;
  suffix: string;
  /** Whether the pattern had a `*`. Exact patterns match the whole specifier. */
  wildcard: boolean;
  /** Substitutions, already resolved against baseUrl. */
  targets: Array<string>;
}

export interface AliasMap {
  /** Candidate paths for a specifier, best first. Empty when nothing matches. */
  candidates: (specifier: string) => Array<string>;
  /**
   * The `baseUrl` fallback, tried after `candidates` and reported differently.
   *
   * TypeScript resolves a bare specifier against `baseUrl` even with no `paths`
   * entry at all -- `"baseUrl": "src"` makes `import 'components/Button'` work.
   * Verified against ts.resolveModuleName rather than assumed.
   *
   * Kept separate from `candidates` because a miss means something different:
   * an unresolved `paths` match is a typo (PLATFORM405), but an unresolved baseUrl
   * guess is almost always just an npm package that is not in the vendor set,
   * and reporting *that* as a broken alias would be the wrong diagnosis.
   */
  baseUrlCandidate: (specifier: string) => string | null;
  /** The raw pattern list, for reporting a pattern that shadows a vendor package. */
  patterns: Array<string>;
}

/**
 * Reads tsconfig.json out of the file record and builds the matcher.
 *
 * Returns null when the project configures no aliases, which is the common
 * case and costs nothing.
 */
export function aliasMap(
  files: Record<string, string>,
  warn: (message: string) => void,
  entry = "tsconfig.json",
): AliasMap | null {
  const config = readConfig(files, entry, warn, new Set());
  const paths = config?.compilerOptions?.paths;
  const baseUrl = config?.compilerOptions?.baseUrl;
  // A project can configure either one without the other, and baseUrl alone is
  // enough to change how a bare specifier resolves.
  if ((!paths || Object.keys(paths).length === 0) && baseUrl === undefined)
    return null;

  // `baseUrl` is relative to the tsconfig that declared it. Since TS 4.1 paths
  // work without one, resolved against the tsconfig's own directory -- so the
  // fallback here is the directory, not the project root.
  const base = resolve(dirname(entry), baseUrl ?? ".");

  const patterns: Array<Pattern> = [];
  for (const [pattern, targets] of Object.entries(paths ?? {})) {
    const star = pattern.indexOf("*");
    if (star !== pattern.lastIndexOf("*")) {
      warn(
        `tsconfig paths pattern '${pattern}' has more than one '*' and is ignored.`,
      );
      continue;
    }
    patterns.push({
      prefix: star === -1 ? pattern : pattern.slice(0, star),
      suffix: star === -1 ? "" : pattern.slice(star + 1),
      wildcard: star !== -1,
      targets: targets.map((target) => resolve(base, target)),
    });
  }

  // TypeScript picks the pattern with the longest literal prefix, so `@/ui/*`
  // beats `@/*` for `@/ui/card` regardless of declaration order.
  patterns.sort((a, b) => b.prefix.length - a.prefix.length);

  return {
    patterns: Object.keys(paths ?? {}),
    baseUrlCandidate: (specifier) =>
      baseUrl === undefined ? null : resolve(base, specifier),
    candidates(specifier) {
      for (const pattern of patterns) {
        if (!pattern.wildcard) {
          if (specifier === pattern.prefix) return [...pattern.targets];
          continue;
        }
        if (
          !specifier.startsWith(pattern.prefix) ||
          !specifier.endsWith(pattern.suffix) ||
          specifier.length < pattern.prefix.length + pattern.suffix.length
        ) {
          continue;
        }
        const matched = specifier.slice(
          pattern.prefix.length,
          specifier.length - pattern.suffix.length,
        );
        return pattern.targets.map((target) => target.replace("*", matched));
      }
      return [];
    },
  };
}

/** Follows `extends` through the file record. Package extends cannot be read. */
function readConfig(
  files: Record<string, string>,
  path: string,
  warn: (message: string) => void,
  seen: Set<string>,
): TsConfig | null {
  if (seen.has(path)) return null; // a cycle; whatever we have is enough
  seen.add(path);
  const text = files[path];
  if (text === undefined) return null;

  let config: TsConfig;
  try {
    config = parseJsonc(text) as TsConfig;
  } catch (error) {
    warn(
      `Could not parse ${path}: ${String((error as Error)?.message ?? error)}`,
    );
    return null;
  }

  if (!config?.extends) return config;

  // Only a relative extends can be followed: a package one ("extends":
  // "@tsconfig/node20/tsconfig.json") lives in node_modules, which a browser
  // build does not have. Worth saying out loud rather than silently resolving
  // half the aliases, because the base config is where a monorepo usually puts
  // them.
  if (!config.extends.startsWith(".")) {
    if (!config.compilerOptions?.paths) {
      warn(
        `${path} extends '${config.extends}', which is a package and cannot be read here. ` +
          `Any 'paths' it declares will not apply -- declare them in ${path} instead.`,
      );
    }
    return config;
  }

  const parentPath = resolveConfigPath(
    files,
    resolve(dirname(path), config.extends),
  );
  const parent = parentPath ? readConfig(files, parentPath, warn, seen) : null;
  if (!parent) return config;

  // The child wins, and `paths` replaces rather than merges -- which is what
  // TypeScript does.
  return {
    compilerOptions: {
      ...parent.compilerOptions,
      ...config.compilerOptions,
      // baseUrl in the parent was relative to the *parent*, and readConfig
      // returns it unresolved, so a parent baseUrl with a child that sets none
      // is the one case this gets wrong. Rare enough to name rather than model.
      paths: config.compilerOptions?.paths ?? parent.compilerOptions?.paths,
    },
  };
}

/** `extends: './base'` may omit the .json. */
function resolveConfigPath(files: Record<string, string>, path: string) {
  for (const candidate of [path, `${path}.json`]) {
    if (candidate in files) return candidate;
  }
  return null;
}
