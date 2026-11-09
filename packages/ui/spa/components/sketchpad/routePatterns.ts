/**
 * Routes and the page types they belong to. A route with a `[param]` in it
 * is a type -- `/journal/[slug]` is every journal post -- and a page of that
 * type is the same route with each parameter filled in: `/journal/wool`.
 *
 * Next.js and TanStack spell a parameter differently (`[slug]`, `$slug`);
 * the Studio's routes come here in the `[slug]` spelling, and so do these.
 */

export type RouteSegment =
  | { kind: "static"; text: string }
  /** `[slug]`; `[...slug]` takes several segments; `[[...slug]]` may be empty. */
  | { kind: "param"; name: string; rest: boolean; optional: boolean };

const PARAM = /^\[(\[)?(\.\.\.)?([^\]]+)\]?\]$/;

export function isRoutePattern(route: string): boolean {
  return route.split("/").some((segment) => PARAM.test(segment));
}

export function routeSegments(route: string): RouteSegment[] {
  return route
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment): RouteSegment => {
      const param = PARAM.exec(segment);
      return param
        ? {
            kind: "param",
            name: param[3],
            rest: param[2] !== undefined,
            optional: param[1] !== undefined,
          }
        : { kind: "static", text: segment };
    });
}

/** Whether `route`, a page, is one of the pages of type `pattern`. */
export function routeFitsPattern(route: string, pattern: string): boolean {
  const source = routeSegments(pattern)
    .map((segment) =>
      segment.kind === "static"
        ? `/${segment.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
        : segment.rest
          ? segment.optional
            ? "(?:/[^/]+)*"
            : "(?:/[^/]+)+"
          : "/[^/]+",
    )
    .join("");
  return new RegExp(`^${source === "" ? "/" : source}/?$`).test(route);
}

/**
 * The page of type `pattern` with each parameter filled in, or null while a
 * required one is empty. A value is one segment, or several for a `[...rest]`;
 * spaces become dashes, since a route has none.
 */
export function fillRoute(
  pattern: string,
  values: Record<string, string>,
): string | null {
  const parts: string[] = [];
  for (const segment of routeSegments(pattern)) {
    if (segment.kind === "static") {
      parts.push(segment.text);
      continue;
    }
    const value = (values[segment.name] ?? "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^\/+|\/+$/g, "");
    if (value === "") {
      if (segment.optional) continue;
      return null;
    }
    parts.push(segment.rest ? value : value.replace(/\//g, "-"));
  }
  return "/" + parts.join("/");
}

/** A typed route, with its one leading slash: `about` and `/about` alike. */
export function normalizeRoute(typed: string): string {
  const path = typed.trim().replace(/\s+/g, "-").replace(/^\/+/, "");
  return "/" + path;
}
