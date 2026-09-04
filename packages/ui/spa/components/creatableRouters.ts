import {
  ModuleFilePath,
  SerializedRecordSchema,
  SerializedSchema,
} from "@valbuild/core";
import { RoutePattern, parseRoutePattern } from "@valbuild/shared/internal";

/** The id `s.router(externalPageRouter, ...)` serializes to. */
const EXTERNAL_ROUTER_ID = "external-url-router";

/**
 * A router module an editor can create an entry in.
 */
export type CreatableRouter = {
  moduleFilePath: ModuleFilePath;
  /** Router id, e.g. `next-app-router` or `external-url-router`. */
  routerId: string;
  /** Parsed pattern of the route, for the key inputs. */
  routePattern: RoutePattern[];
  /** Human-readable pattern, e.g. `/blogs/[blog]`. */
  patternString: string;
  /** Keys that already exist, so the form can refuse a duplicate. */
  existingKeys: string[];
  /** The router key schema's description, if it has one. */
  keyDescription?: string;
};

function isRouterSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedRecordSchema & { router: string } {
  return schema?.type === "record" && typeof schema.router === "string";
}

function patternStringOf(routePattern: RoutePattern[]): string {
  if (routePattern.length === 0) {
    return "/";
  }
  return routePattern
    .map((part) =>
      part.type === "literal"
        ? `/${part.name}`
        : part.type === "array-param"
          ? `/[...${part.paramName}]`
          : `/[${part.paramName}]`,
    )
    .join("");
}

/** Whether a router id is that of the external page router. */
export function isExternalRouter(routerId: string): boolean {
  return routerId === EXTERNAL_ROUTER_ID;
}

/**
 * The route pattern a router module serves, e.g. `/blogs/[blog]`.
 *
 * Exported because a key of a router record IS a route: anything that lets an
 * editor create one - the sitemap, a `s.route()` field, a `s.keyOf()` field
 * pointing at a router - needs the pattern to know which segments to ask for.
 */
export function routePatternOfRouterModule(
  moduleFilePath: ModuleFilePath,
): RoutePattern[] {
  return parseRoutePattern(routePatternSourceOf(moduleFilePath));
}

/**
 * A next-app-router module lives at the route it serves, so the route pattern is
 * the module path with the Val and Next.js file conventions stripped.
 */
function routePatternSourceOf(moduleFilePath: ModuleFilePath): string {
  return moduleFilePath
    .replace(/^\/(src\/)?app/, "")
    .replace(/\/page\.val\.[tj]sx?$/, "")
    .replace(/\.val\.[tj]sx?$/, "");
}

/**
 * Reads the routers out of the schemas and sources, split by kind.
 *
 * Pure, so it can be tested without a provider tree: `useCreatableRouters` is
 * only the memoised React wrapper around this.
 */
export function collectCreatableRouters(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, unknown>,
): { pageRouters: CreatableRouter[]; externalRouter: CreatableRouter | null } {
  const pageRouters: CreatableRouter[] = [];
  let externalRouter: CreatableRouter | null = null;
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (!isRouterSchema(schema)) {
      continue;
    }
    const source = sources[moduleFilePath];
    const existingKeys =
      source && typeof source === "object" && !Array.isArray(source)
        ? Object.keys(source)
        : [];
    const routePattern = routePatternOfRouterModule(moduleFilePath);
    const entry: CreatableRouter = {
      moduleFilePath,
      routerId: schema.router,
      routePattern,
      patternString: patternStringOf(routePattern),
      existingKeys,
      keyDescription: schema.key?.description,
    };
    if (isExternalRouter(schema.router)) {
      // At most one external router per project, as elsewhere in the studio.
      externalRouter = externalRouter ?? entry;
    } else {
      pageRouters.push(entry);
    }
  }
  pageRouters.sort((a, b) => a.patternString.localeCompare(b.patternString));
  return { pageRouters, externalRouter };
}
