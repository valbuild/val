import { ModuleFilePath } from "./val";

export const externalPageRouter: ValRouter = {
  getRouterId: () => "external-url-router",
  validate: (_moduleFilePath, urlPaths): RouteValidationError[] => {
    const errors: RouteValidationError[] = [];
    for (const urlPath of urlPaths) {
      if (!(urlPath.startsWith("https://") || urlPath.startsWith("http://"))) {
        errors.push({
          error: {
            message: `URL path "${urlPath}" does not start with "https://" or "http://"`,
            expectedPath: null,
            urlPath,
          },
        });
      }
    }
    return [];
  },
};

export type RouteValidationError = {
  error: {
    message: string;
    urlPath: string;
    expectedPath: string | null;
  };
};

// Helper function to validate a URL path against a route pattern
export function validateUrlAgainstPattern(
  urlPath: string,
  routePattern: string[],
): { isValid: boolean; expectedPath?: string } {
  // Remove leading slash and split URL path
  const urlSegments = urlPath.startsWith("/")
    ? urlPath.slice(1).split("/")
    : urlPath.split("/");

  // Handle empty patterns (root route)
  if (routePattern.length === 0) {
    return {
      isValid:
        urlSegments.length === 0 ||
        (urlSegments.length === 1 && urlSegments[0] === ""),
      expectedPath: "/",
    };
  }

  // Check if segment counts match (accounting for optional segments and catch-all)
  let minSegments = 0;
  let maxSegments = 0;
  let hasCatchAll = false;
  let catchAllIndex = -1;

  for (let i = 0; i < routePattern.length; i++) {
    const segment = routePattern[i];
    if (segment.startsWith("[[") && segment.endsWith("]]")) {
      // Optional catch-all segment
      hasCatchAll = true;
      catchAllIndex = i;
      maxSegments = Infinity;
    } else if (segment.startsWith("[...") && segment.endsWith("]")) {
      // Required catch-all segment
      hasCatchAll = true;
      catchAllIndex = i;
      minSegments++;
      maxSegments = Infinity;
    } else if (segment.startsWith("[[") && segment.endsWith("]")) {
      // Optional segment
      maxSegments++;
    } else if (segment.startsWith("[") && segment.endsWith("]")) {
      // Required segment
      minSegments++;
      maxSegments++;
    } else {
      // Static segment
      minSegments++;
      maxSegments++;
    }
  }

  // Check segment count
  if (
    urlSegments.length < minSegments ||
    (!hasCatchAll && urlSegments.length > maxSegments)
  ) {
    const expectedSegments = routePattern
      .map((seg) => {
        if (seg.startsWith("[[") && seg.endsWith("]]")) {
          return `[optional:${seg.slice(2, -2)}]`;
        } else if (seg.startsWith("[...") && seg.endsWith("]")) {
          return `[...${seg.slice(4, -1)}]`;
        } else if (seg.startsWith("[[") && seg.endsWith("]")) {
          return `[optional:${seg.slice(2, -1)}]`;
        } else if (seg.startsWith("[") && seg.endsWith("]")) {
          return `[${seg.slice(1, -1)}]`;
        }
        return seg;
      })
      .join("/");
    return {
      isValid: false,
      expectedPath: `/${expectedSegments}`,
    };
  }

  // Validate each segment up to the catch-all or the end of the pattern
  const segmentsToValidate = hasCatchAll ? catchAllIndex : routePattern.length;
  for (let i = 0; i < segmentsToValidate; i++) {
    const patternSegment = routePattern[i];
    const urlSegment = urlSegments[i];

    // Handle optional segments
    if (patternSegment.startsWith("[[") && patternSegment.endsWith("]]")) {
      // Optional segment - can be empty or match
      if (urlSegment !== "" && urlSegment !== undefined) {
        // If provided, validate it's not empty
        if (urlSegment === "") {
          return {
            isValid: false,
            expectedPath: `/${routePattern.join("/")}`,
          };
        }
      }
    } else if (patternSegment.startsWith("[") && patternSegment.endsWith("]")) {
      // Required dynamic segment - just check it's not empty
      if (urlSegment === "" || urlSegment === undefined) {
        return {
          isValid: false,
          expectedPath: `/${routePattern.join("/")}`,
        };
      }
    } else {
      // Static segment - must match exactly
      if (patternSegment !== urlSegment) {
        return {
          isValid: false,
          expectedPath: `/${routePattern.join("/")}`,
        };
      }
    }
  }

  return { isValid: true };
}

// This router should not be in core package
export const nextAppRouter: ValRouter = {
  getRouterId: () => "next-app-router",
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
  validate(
    moduleFilePath: ModuleFilePath,
    urlPaths: string[],
  ): RouteValidationError[];
}
