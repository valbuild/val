import { ModuleFilePath } from "./val";
import {
  describeSchemeRejection,
  ExternalUrlSchemePolicy,
  rejectScheme,
} from "./externalUrlSchemes";

/**
 * The router whose keys are URLs to somewhere else.
 *
 * Used directly for the wide default, or called to narrow it:
 *
 * ```ts
 * s.router(externalPageRouter, item)                          // anything safe
 * s.router(externalPageRouter({ schemes: ["https"] }), item)  // https only
 * ```
 *
 * Its one rule is that a key has a scheme, and that the scheme is not one of
 * the handful that are not links at all - see `externalUrlSchemes.ts`. That
 * rule was WRITTEN here from the start and never enforced: the errors were
 * collected into a list and then `return []` threw them away, so every key was
 * accepted however it was spelled.
 *
 * `expectedPath` is null because there is nothing to suggest: a key that is
 * not a URL could have been meant as any URL, and guessing `https://` in front
 * of it would propose a different site as often as the right one.
 */
export const externalPageRouter: ExternalPageRouter = Object.assign(
  (policy: ExternalUrlSchemePolicy): ValRouter =>
    createExternalPageRouter(policy),
  createExternalPageRouter(),
);

/**
 * Callable AND a router, so `externalPageRouter` keeps working unchanged
 * where nobody needs to configure it - which is almost everywhere.
 */
export type ExternalPageRouter = ValRouter &
  ((policy: ExternalUrlSchemePolicy) => ValRouter);

function createExternalPageRouter(
  policy: ExternalUrlSchemePolicy = {},
): ValRouter {
  return {
    getRouterId: () => "external-url-router",
    getUrlSchemePolicy: () => policy,
    validate: (_moduleFilePath, urlPaths): RouteValidationError[] => {
      const errors: RouteValidationError[] = [];
      for (const urlPath of urlPaths) {
        const rejection = rejectScheme(urlPath, policy);
        if (rejection !== null) {
          errors.push({
            error: {
              message: `URL "${urlPath}" cannot be used here. ${describeSchemeRejection(rejection)}`,
              expectedPath: null,
              urlPath,
            },
          });
        }
      }
      return errors;
    },
  };
}

export type RouteValidationError = {
  error: {
    message: string;
    urlPath: string;
    expectedPath: string | null;
  };
};

/**
 * The value of each parameter a URL gives a route pattern, or `null` when the
 * URL is not one of that pattern's.
 *
 * A parameter that an OPTIONAL segment left out is `null` rather than absent,
 * so a caller can tell "this route has no such parameter" from "this URL did
 * not use it". A catch-all's segments are joined with `/`, which is how they
 * appear in the key; an optional catch-all with nothing to catch is `null`.
 *
 * The pattern vocabulary is the one both parsers produce: `[name]` is a
 * segment, `[[name]]` an optional one, `[...name]` a catch-all and
 * `[[...name]]` an optional catch-all; anything else is literal.
 *
 * Optional segments are what make this a search rather than a walk: in
 * `/[[locale]]/blog/[slug]` the URL `/blog/hello` only matches once `blog`
 * has been tried as the locale and given back. A present segment is tried
 * first, so `/nb/blog/hello` reads as the locale `nb` — the reading the router
 * itself makes.
 */
export function matchRoutePattern(
  urlPath: string,
  routePattern: string[],
): Record<string, string | null> | null {
  const trimmed = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
  const urlSegments = trimmed === "" ? [] : trimmed.split("/");
  return matchFrom(routePattern, 0, urlSegments, 0, {});
}

type PatternSegment =
  | { type: "literal"; value: string }
  | { type: "param"; name: string; optional: boolean; catchAll: boolean };

function readPatternSegment(segment: string): PatternSegment {
  const optional = segment.startsWith("[[") && segment.endsWith("]]");
  const required =
    !optional && segment.startsWith("[") && segment.endsWith("]");
  if (!optional && !required) {
    return { type: "literal", value: segment };
  }
  const inner = optional ? segment.slice(2, -2) : segment.slice(1, -1);
  const catchAll = inner.startsWith("...");
  return {
    type: "param",
    name: catchAll ? inner.slice(3) : inner,
    optional,
    catchAll,
  };
}

/**
 * The parameters a route pattern has, by name, and whether a URL may leave
 * each one out.
 */
export function routeParamsOfPattern(
  routePattern: string[],
): { name: string; optional: boolean }[] {
  return routePattern.flatMap((each) => {
    const segment = readPatternSegment(each);
    return segment.type === "param"
      ? [{ name: segment.name, optional: segment.optional }]
      : [];
  });
}

function matchFrom(
  routePattern: string[],
  patternIndex: number,
  urlSegments: string[],
  urlIndex: number,
  params: Record<string, string | null>,
): Record<string, string | null> | null {
  if (patternIndex === routePattern.length) {
    return urlIndex === urlSegments.length ? params : null;
  }
  const segment = readPatternSegment(routePattern[patternIndex]);
  const next = (consumed: number, value: string | null) =>
    matchFrom(
      routePattern,
      patternIndex + 1,
      urlSegments,
      urlIndex + consumed,
      segment.type === "param" ? { ...params, [segment.name]: value } : params,
    );
  if (segment.type === "literal") {
    return urlSegments[urlIndex] === segment.value ? next(1, null) : null;
  }
  const remaining = urlSegments.length - urlIndex;
  if (segment.catchAll) {
    // Longest first: a catch-all is almost always last, where the only
    // length that can match is "all of it".
    for (let count = remaining; count >= 1; count--) {
      const taken = urlSegments.slice(urlIndex, urlIndex + count);
      if (taken.some((each) => each === "")) {
        continue;
      }
      const matched = next(count, taken.join("/"));
      if (matched) {
        return matched;
      }
    }
    return segment.optional ? next(0, null) : null;
  }
  const value = urlSegments[urlIndex];
  if (value !== undefined && value !== "") {
    const matched = next(1, value);
    if (matched) {
      return matched;
    }
  }
  return segment.optional ? next(0, null) : null;
}

/**
 * Whether a URL is one of a route pattern's, and the pattern to show when not.
 */
export function validateUrlAgainstPattern(
  urlPath: string,
  routePattern: string[],
): { isValid: boolean; expectedPath?: string } {
  if (matchRoutePattern(urlPath, routePattern) !== null) {
    return { isValid: true };
  }
  return { isValid: false, expectedPath: `/${routePattern.join("/")}` };
}

// This router should not be in core package
export const nextAppRouter: ValRouter = {
  getRouterId: () => "next-app-router",
  getRoutePattern: (moduleFilePath) => parseNextJsRoutePattern(moduleFilePath),
  validate: (moduleFilePath, urlPaths) => {
    const routePattern = parseNextJsRoutePattern(moduleFilePath);
    const errors: RouteValidationError[] = [];

    for (const urlPath of urlPaths) {
      const validation = validateUrlAgainstPattern(urlPath, routePattern);

      if (!validation.isValid) {
        errors.push({
          error: {
            message: `URL path "${urlPath}" does not match the route pattern for "${moduleFilePath}"`,
            urlPath,
            expectedPath: validation.expectedPath || null,
          },
        });
      }
    }

    return errors;
  },
};

/**
 * Parse Next.js route pattern from file path
 * Support multiple Next.js app directory structures:
 * - /app/blogs/[blog]/page.val.ts -> ["blogs", "[blog]"]
 * - /src/app/blogs/[blog]/page.val.ts -> ["blogs", "[blog]"]
 * - /pages/blogs/[blog].tsx -> ["blogs", "[blog]"] (Pages Router)
 * - /app/(group)/blogs/[blog]/page.val.ts -> ["blogs", "[blog]"] (with groups)
 * - /app/(.)feed/page.val.ts -> ["feed"] (interception route)
 * - /app/(..)(dashboard)/feed/page.val.ts -> ["feed"] (interception route)
 */
export function parseNextJsRoutePattern(moduleFilePath: string): string[] {
  if (!moduleFilePath || typeof moduleFilePath !== "string") {
    return [];
  }

  // Try App Router patterns first
  const appRouterPatterns = [
    /\/app\/(.+)\/page\.val\.ts$/, // /app/...
    /\/src\/app\/(.+)\/page\.val\.ts$/, // /src/app/...
    /\/app\/(.+)\/page\.tsx?$/, // /app/... with .tsx
    /\/src\/app\/(.+)\/page\.tsx?$/, // /src/app/... with .tsx
  ];

  for (const pattern of appRouterPatterns) {
    const match = moduleFilePath.match(pattern);
    if (match) {
      const routePath = match[1];
      // Remove group and interception segments
      // Group: (group), Interception: (.), (..), (..)(dashboard), etc.
      return routePath.split("/").flatMap((segment) => {
        // Remove group segments (but not interception segments)
        if (
          segment.startsWith("(") &&
          segment.endsWith(")") &&
          !segment.includes(".")
        )
          return [];
        // Interception segments: (.)feed, (..)(dashboard)/feed, etc.
        // If segment starts with (.) or (..), strip the interception marker and keep the rest
        const interceptionMatch = segment.match(/^(\([.]+\)(\(.+\))?)(.*)$/);
        if (interceptionMatch) {
          const rest = interceptionMatch[3] || interceptionMatch[4];
          return rest ? [rest] : [];
        }
        return [segment];
      });
    }
  }

  return [];
}

/**
 * Parse a TanStack Router route pattern out of a Val module file path.
 *
 * TanStack Router's file conventions are not Next's, so this is a different
 * parser rather than a flag on the one above. A Val module for a route lives
 * beside the route file and is named the same way — `routes/posts.$postId.tsx`
 * is served content by `routes/posts.$postId.val.ts` — so the pattern is the
 * file path with the conventions applied:
 *
 * - `.` and `/` both separate segments (`posts.$postId.val.ts` and
 *   `posts/$postId.val.ts` are the same route)
 * - `$param` is a dynamic segment, `$` on its own is a splat
 * - `{-$param}` is an optional segment, written `[[param]]`
 * - `index` is the directory's own route and contributes no segment
 * - `route` is a layout for the directory, likewise
 * - `(group)` folders and `_pathless` layout segments are not in the URL
 * - a trailing `_` on a segment opts out of nesting and is not in the URL
 *
 * The result is expressed in the SAME vocabulary the Next parser uses
 * (`[param]`, `[...param]`), because everything downstream — validation, the
 * sitemap, the key inputs in the Studio — is written against that vocabulary
 * and there is no reason for two.
 *
 * - /src/routes/posts.$postId.val.ts -> ["posts", "[postId]"]
 * - /routes/posts/$postId.val.ts     -> ["posts", "[postId]"]
 * - /src/routes/index.val.ts         -> []
 * - /src/routes/files.$.val.ts       -> ["files", "[..._splat]"]
 * - /src/routes/{-$locale}.about.val.ts -> ["[[locale]]", "about"]
 * - /src/routes/(app)/_layout.about.val.ts -> ["about"]
 */
export function parseTanStackRoutePattern(moduleFilePath: string): string[] {
  const segments = tanStackRouteSegments(moduleFilePath);
  if (segments === null) {
    return [];
  }
  return segments;
}

/**
 * The segments, or `null` when the path is not a TanStack route module at all.
 *
 * Distinct from `parseTanStackRoutePattern`'s empty array, which is a real
 * answer: the root route `/` has no segments.
 */
function tanStackRouteSegments(moduleFilePath: string): string[] | null {
  if (!moduleFilePath || typeof moduleFilePath !== "string") {
    return null;
  }
  const match = moduleFilePath.match(
    /^(?:\/src)?\/routes\/(.+)\.val\.[tj]sx?$/,
  );
  if (!match) {
    return null;
  }
  return tanStackSegmentsOfRoutePath(match[1]);
}

/**
 * The URL segments of a TanStack route path, given relative to `routes/`.
 *
 * Exported because the Studio derives the same pattern from the same file path
 * and must not disagree with validation about what a route is.
 */
export function tanStackSegmentsOfRoutePath(routePath: string): string[] {
  // `.` is a separator exactly like `/`, so flatten both before looking at any
  // segment: `posts/$postId.edit` and `posts.$postId.edit` are one route.
  const rawSegments = routePath
    .split("/")
    .flatMap((part) => part.split("."))
    .filter((part) => part !== "");
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    // A route group: a folder that organises files without appearing in the URL.
    if (rawSegment.startsWith("(") && rawSegment.endsWith(")")) {
      continue;
    }
    // A pathless layout route. `_layout` nests its children without adding a
    // segment; `index`/`route` are the directory's own route and its layout.
    if (rawSegment.startsWith("_")) {
      continue;
    }
    if (rawSegment === "index" || rawSegment === "route") {
      continue;
    }
    // A trailing `_` opts the segment out of layout nesting; the URL keeps the
    // name without it.
    const segment = rawSegment.endsWith("_")
      ? rawSegment.slice(0, -1)
      : rawSegment;
    if (segment === "$") {
      // A splat. Named `_splat` because that is the param name TanStack gives
      // it, so `useValRoute(pageVal, params)` can be handed the route's own
      // params object unchanged.
      segments.push("[..._splat]");
      continue;
    }
    if (segment.startsWith("$")) {
      segments.push(`[${segment.slice(1)}]`);
      continue;
    }
    // An optional parameter: the URL may leave the segment out. `{-$locale}`
    // is how a site serves its default language without a prefix.
    const optional = segment.match(/^\{-\$([^{}]+)\}$/);
    if (optional) {
      segments.push(`[[${optional[1]}]]`);
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

/**
 * The router for a TanStack Router (and TanStack Start) app.
 *
 * Like `nextAppRouter` this does not belong in core — it is here for the same
 * reason that one is: the serialized schema carries only a router id, so the
 * thing that turns an id back into a validator has to be somewhere every
 * consumer can reach.
 */
export const tanstackRouter: ValRouter = {
  getRouterId: () => "tanstack-router",
  getRoutePattern: (moduleFilePath) =>
    parseTanStackRoutePattern(moduleFilePath),
  validate: (moduleFilePath, urlPaths) => {
    const routePattern = parseTanStackRoutePattern(moduleFilePath);
    const errors: RouteValidationError[] = [];

    for (const urlPath of urlPaths) {
      const validation = validateUrlAgainstPattern(urlPath, routePattern);

      if (!validation.isValid) {
        errors.push({
          error: {
            message: `URL path "${urlPath}" does not match the route pattern for "${moduleFilePath}"`,
            urlPath,
            expectedPath: validation.expectedPath || null,
          },
        });
      }
    }

    return errors;
  },
};

export interface ValRouter {
  getRouterId(): string;
  /**
   * Which URL schemes this router's keys may use, where it restricts them.
   *
   * Serialized alongside the router id so the Studio can apply the SAME rule
   * while someone types, rather than accepting a key and reporting it as a
   * validation error afterwards. Absent on routers whose keys are paths rather
   * than URLs, which is every other one.
   */
  getUrlSchemePolicy?(): ExternalUrlSchemePolicy;
  /**
   * The route pattern a module of this router serves, in the `[param]`
   * vocabulary — see {@link matchRoutePattern}.
   *
   * What lets `s.router(router, { locale: …, slug: … }, item)` find a key's
   * parameters by NAME. Absent on a router whose keys are not paths of this
   * site, which therefore has no parameters to give a schema to.
   */
  getRoutePattern?(moduleFilePath: ModuleFilePath): string[];
  validate(
    moduleFilePath: ModuleFilePath,
    urlPaths: string[],
  ): RouteValidationError[];
}
