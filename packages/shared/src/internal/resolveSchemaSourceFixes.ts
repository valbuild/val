import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import {
  filterRoutesByPatterns,
  validateRoutePatterns,
  type SerializedRegExpPattern,
} from "./routeValidation";

export type SchemaSourceSnapshot = {
  schemas: Record<ModuleFilePath, SerializedSchema>;
  sources: Record<ModuleFilePath, Json>;
};

const TYPE_ERROR_MESSAGE = `This is most likely a Val version mismatch or Val bug.`;

export type RouteInfo = {
  route: string;
  moduleFilePath: ModuleFilePath;
};

export function getRoutesWithModulePaths(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Json>,
): RouteInfo[] {
  const routeMap = new Map<string, ModuleFilePath>();

  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    const source = sources[moduleFilePath];

    if (
      schema &&
      schema.type === "record" &&
      schema.router &&
      source &&
      typeof source === "object" &&
      !Array.isArray(source)
    ) {
      for (const key in source) {
        if (!routeMap.has(key)) {
          routeMap.set(key, moduleFilePath);
        }
      }
    }
  }

  const routes: RouteInfo[] = Array.from(routeMap.entries()).map(
    ([route, moduleFilePath]) => ({ route, moduleFilePath }),
  );
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

export function getRoutesOf(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Json>,
): string[] {
  return getRoutesWithModulePaths(schemas, sources).map((r) => r.route);
}

// GPT generated levenshtein distance algorithm
export const levenshtein = (a: string, b: string): number => {
  const [m, n] = [a.length, b.length];
  if (!m || !n) return Math.max(m, n);

  const dp = Array.from({ length: m + 1 }, (_, i) => i);

  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;

    for (let i = 1; i <= m; i++) {
      const temp = dp[i];
      dp[i] =
        a[i - 1] === b[j - 1]
          ? prev
          : Math.min(prev + 1, dp[i - 1] + 1, dp[i] + 1);
      prev = temp;
    }
  }

  return dp[m];
};

export function findSimilar(
  key: string,
  targets: string[],
): { target: string; distance: number }[] {
  return targets
    .map((target) => ({ target, distance: levenshtein(key, target) }))
    .sort((a, b) => a.distance - b.distance);
}

type CheckResult = { error: false } | { error: true; message: string };

function getKeyOfRecordAt(
  sourcePath: SourcePath,
  snapshot: SchemaSourceSnapshot,
): { source: unknown; schema: SerializedSchema | undefined } {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const moduleSource = snapshot.sources[moduleFilePath];
  const moduleSchema = snapshot.schemas[moduleFilePath];
  if (!moduleSchema || moduleSource === undefined) {
    return { source: undefined, schema: undefined };
  }
  if (!modulePath) {
    return { source: moduleSource, schema: moduleSchema };
  }
  // Walk both schema and source. This intentionally only follows the
  // patterns produced by keyOf().sourcePath — typically a top-level record or
  // an object property pointing at a record. The walk is best-effort and
  // returns undefined source on any mismatch.
  let source: unknown = moduleSource;
  let schema: SerializedSchema | undefined = moduleSchema;
  for (const part of Internal.splitModulePath(modulePath)) {
    if (
      source &&
      typeof source === "object" &&
      !Array.isArray(source) &&
      part in source
    ) {
      source = (source as Record<string, unknown>)[part];
    } else {
      source = undefined;
    }
    if (schema && schema.type === "object" && schema.items[part]) {
      schema = schema.items[part];
    } else if (schema && schema.type === "record") {
      schema = schema.item;
    } else {
      schema = undefined;
    }
  }
  return { source, schema };
}

function checkKeyIsValid(
  key: string,
  sourcePath: SourcePath,
  snapshot: SchemaSourceSnapshot,
): CheckResult {
  const { source: keyOfModuleSource, schema: keyOfModuleSchema } =
    getKeyOfRecordAt(sourcePath, snapshot);

  if (keyOfModuleSchema && keyOfModuleSchema.type !== "record") {
    return {
      error: true,
      message: `Expected key at ${sourcePath} to be of type 'record'`,
    };
  }
  if (
    keyOfModuleSource &&
    typeof keyOfModuleSource === "object" &&
    key in keyOfModuleSource
  ) {
    return { error: false };
  }
  if (
    !keyOfModuleSource ||
    typeof keyOfModuleSource !== "object" ||
    Array.isArray(keyOfModuleSource)
  ) {
    return {
      error: true,
      message: `Expected ${sourcePath} to be a truthy object`,
    };
  }
  const alternatives = findSimilar(
    key,
    Object.keys(keyOfModuleSource as Record<string, unknown>),
  );
  if (alternatives.length === 0) {
    return {
      error: true,
      message: `Key '${key}' does not exist in ${sourcePath}.`,
    };
  }
  return {
    error: true,
    message: `Key '${key}' does not exist in ${sourcePath}. Closest match: '${alternatives[0].target}'. Other similar: ${alternatives
      .slice(1, 4)
      .map((a) => `'${a.target}'`)
      .join(", ")}${alternatives.length > 4 ? ", ..." : ""}`,
  };
}

function checkRouteIsValid(
  route: string,
  includePattern: SerializedRegExpPattern | undefined,
  excludePattern: SerializedRegExpPattern | undefined,
  snapshot: SchemaSourceSnapshot,
): CheckResult {
  const routerModules: Record<string, string[]> = {};
  for (const moduleFilePathS in snapshot.schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = snapshot.schemas[moduleFilePath];
    if (schema?.type === "record" && schema.router) {
      const source = snapshot.sources[moduleFilePath];
      if (source && typeof source === "object" && !Array.isArray(source)) {
        routerModules[moduleFilePath] = Object.keys(
          source as Record<string, unknown>,
        );
      }
    }
  }

  const moduleEntries = Object.entries(routerModules);
  let foundInModule: string | null = null;
  for (const [moduleFilePath, routes] of moduleEntries) {
    if (routes.includes(route)) {
      foundInModule = moduleFilePath;
      break;
    }
  }

  if (!foundInModule) {
    let allRoutes = moduleEntries.flatMap(([, routes]) => routes);
    if (allRoutes.length === 0) {
      return {
        error: true,
        message: `Route '${route}' could not be validated: No router modules found in the project. Use s.record(...).router(...) to define router modules.`,
      };
    }
    allRoutes = filterRoutesByPatterns(
      allRoutes,
      includePattern,
      excludePattern,
    );
    const alternatives = findSimilar(route, allRoutes);
    return {
      error: true,
      message: `Route '${route}' does not exist in any router module. ${
        alternatives.length > 0
          ? `Closest match: '${alternatives[0].target}'. Other similar: ${alternatives
              .slice(1, 4)
              .map((a) => `'${a.target}'`)
              .join(", ")}${alternatives.length > 4 ? ", ..." : ""}`
          : "No similar routes found."
      }`,
    };
  }

  const patternValidation = validateRoutePatterns(
    route,
    includePattern,
    excludePattern,
  );
  if (!patternValidation.valid) {
    return { error: true, message: patternValidation.message };
  }
  return { error: false };
}

export type ResolvedFix =
  | { status: "resolved" }
  | { status: "remaining"; error: ValidationError };

/**
 * Resolves a single `keyof:check-keys` or `router:check-route` error against
 * the given schema/source snapshot. Returns:
 *   - null if the error is not one of these fixes (caller should pass through)
 *   - { status: "resolved" } if the referenced key/route is valid (drop error)
 *   - { status: "remaining"; error } if invalid (rewritten error to surface)
 */
export function resolveSchemaSourceFixForError(
  error: ValidationError,
  snapshot: SchemaSourceSnapshot,
): ResolvedFix | null {
  const fixes = error.fixes ?? [];
  if (fixes.includes("keyof:check-keys")) {
    if (!error.value) {
      return {
        status: "remaining",
        error: {
          ...error,
          message: `Could not find a value for keyOf. ${TYPE_ERROR_MESSAGE}`,
          typeError: true,
          fixes: undefined,
        },
      };
    }
    if (typeof error.value !== "object") {
      return {
        status: "remaining",
        error: {
          ...error,
          message: `Expected keyOf validation error to have a 'value' property of type 'object'. Found: ${typeof error.value}. ${TYPE_ERROR_MESSAGE}`,
          typeError: true,
          fixes: undefined,
        },
      };
    }
    const valueObj = error.value as { key?: unknown; sourcePath?: unknown };
    const key = valueObj.key;
    const valueSourcePath = valueObj.sourcePath;
    if (typeof key !== "string") {
      return {
        status: "remaining",
        error: {
          ...error,
          message: `Expected keyOf validation error 'value' to have property 'key' of type 'string'. Found: ${typeof key}. ${TYPE_ERROR_MESSAGE}`,
          typeError: true,
          fixes: undefined,
        },
      };
    }
    if (typeof valueSourcePath !== "string") {
      return {
        status: "remaining",
        error: {
          ...error,
          message: `Expected keyOf validation error 'value' to have property 'sourcePath' of type 'string'. Found: ${typeof valueSourcePath}. ${TYPE_ERROR_MESSAGE}`,
          typeError: true,
          fixes: undefined,
        },
      };
    }
    const res = checkKeyIsValid(key, valueSourcePath as SourcePath, snapshot);
    if (res.error) {
      return {
        status: "remaining",
        error: { ...error, message: res.message, fixes: undefined },
      };
    }
    return { status: "resolved" };
  }

  if (fixes.includes("router:check-route")) {
    if (!error.value) {
      return {
        status: "remaining",
        error: {
          ...error,
          message: `Could not find a value for route. ${TYPE_ERROR_MESSAGE}`,
          typeError: true,
          fixes: undefined,
        },
      };
    }
    if (typeof error.value !== "object") {
      return {
        status: "remaining",
        error: {
          ...error,
          message: `Expected route validation error to have a 'value' property of type 'object'. Found: ${typeof error.value}. ${TYPE_ERROR_MESSAGE}`,
          typeError: true,
          fixes: undefined,
        },
      };
    }
    const valueObj = error.value as {
      route?: unknown;
      include?: unknown;
      exclude?: unknown;
    };
    const route = valueObj.route;
    if (typeof route !== "string") {
      return {
        status: "remaining",
        error: {
          ...error,
          message: `Expected route validation error 'value' to have property 'route' of type 'string'. Found: ${typeof route}. ${TYPE_ERROR_MESSAGE}`,
          typeError: true,
          fixes: undefined,
        },
      };
    }
    const include = asRegExpPattern(valueObj.include);
    const exclude = asRegExpPattern(valueObj.exclude);
    const res = checkRouteIsValid(route, include, exclude, snapshot);
    if (res.error) {
      return {
        status: "remaining",
        error: { ...error, message: res.message, fixes: undefined },
      };
    }
    return { status: "resolved" };
  }

  return null;
}

function asRegExpPattern(value: unknown): SerializedRegExpPattern | undefined {
  if (
    value &&
    typeof value === "object" &&
    "source" in value &&
    "flags" in value &&
    typeof (value as { source: unknown }).source === "string" &&
    typeof (value as { flags: unknown }).flags === "string"
  ) {
    return value as SerializedRegExpPattern;
  }
  return undefined;
}

/**
 * Apply schema/source fix resolution across a map of validation errors.
 *
 * Errors with `keyof:check-keys` or `router:check-route` are resolved against
 * the in-memory schema/source snapshot — valid references drop the error,
 * invalid ones are rewritten with a "did you mean…" message and have their
 * `fixes` cleared (so downstream code reports them as plain validation errors).
 * All other errors pass through untouched.
 *
 * Source paths with no remaining errors are removed from the result.
 */
export function resolveSchemaSourceFixes(
  validationErrors: Record<SourcePath, ValidationError[]>,
  snapshot: SchemaSourceSnapshot,
): Record<SourcePath, ValidationError[]> {
  const result: Record<SourcePath, ValidationError[]> = {};
  for (const sourcePathS in validationErrors) {
    const sourcePath = sourcePathS as SourcePath;
    const remaining: ValidationError[] = [];
    for (const error of validationErrors[sourcePath]) {
      const resolved = resolveSchemaSourceFixForError(error, snapshot);
      if (resolved === null) {
        remaining.push(error);
      } else if (resolved.status === "remaining") {
        remaining.push(resolved.error);
      }
    }
    if (remaining.length > 0) {
      result[sourcePath] = remaining;
    }
  }
  return result;
}
