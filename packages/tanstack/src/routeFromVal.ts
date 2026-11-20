import { ModuleFilePath, Internal, RecordSchema } from "@valbuild/core";
import {
  getPatternFromModuleFilePath,
  getTanStackRouterSourceFolder,
  parseRoutePattern,
  RoutePattern,
} from "@valbuild/shared/client";

export function getValRouteUrlFromVal(
  resolvedParams: Record<string, string | string[]> | unknown,
  methodName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  path: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  val: any,
) {
  if (!path) {
    Internal.log.error(
      `${methodName} can only be used with a Val module (details: no Val path found).`,
    );
    return null;
  }
  if (val === null) {
    return null;
  }
  if (typeof val !== "object") {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: expected type object, found ${typeof val} instead).`,
    );
    return null;
  }
  if (Array.isArray(val)) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: expected type object, found array instead).`,
    );
    return null;
  }
  if (!schema) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: no schema found).`,
    );
    return null;
  }
  if (!(schema instanceof RecordSchema)) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: schema is not a record).`,
    );
  } else if (!schema["currentRouter"]) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: router is not set).`,
    );
  } else if (
    schema["currentRouter"].getRouterId() !==
      Internal.tanstackRouter.getRouterId() &&
    schema["currentRouter"].getRouterId() !==
      Internal.externalPageRouter.getRouterId()
  ) {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: router is not the TanStack Router or External URL Page Router).`,
    );
    return null;
  }
  if (typeof resolvedParams !== "object") {
    Internal.log.error(
      `${methodName} must be used with a Val Module that is a s.record().router(...) (details: params is not an object).`,
    );
    return null;
  }
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  /*
   * A route module is named after the route file it sits beside.
   *
   * There is no `page.val.ts` here, because TanStack Router has no `page.tsx`:
   * the route file IS the name of the route, so `routes/posts.$postId.tsx` is
   * served by `routes/posts.$postId.val.ts` and the file name is the whole of
   * what says which route this is. Being under `routes/` is therefore the only
   * thing to check.
   */
  const srcFolder = getTanStackRouterSourceFolder(
    moduleFilePath as ModuleFilePath,
  );
  if (!srcFolder) {
    Internal.log.error(
      `${methodName} was used with a Val module that is not in the /routes or /src/routes folder. Name the module after the route file it belongs to, e.g. /src/routes/posts.$postId.val.ts next to /src/routes/posts.$postId.tsx.`,
    );
    return null;
  }
  const pattern = getPatternFromModuleFilePath(moduleFilePath, srcFolder);
  const parsedPattern = parseRoutePattern(pattern);
  const missingPatterns: RoutePattern[] = [];
  const fullPathParts: string[] = [];
  const missingParamKeys =
    typeof resolvedParams === "object" &&
    resolvedParams !== null &&
    !Array.isArray(resolvedParams)
      ? { ...resolvedParams }
      : {};
  /*
   * TanStack names a splat twice, and only one of the names is Val's.
   *
   * `useParams()` on a `$` route returns BOTH `_splat` and `*`, set to the same
   * value — see `interpolatePath` in `@tanstack/router-core`. Val's pattern has
   * one param for it, so the other name was left over at the end of the loop
   * below and reported as a parameter that is not in the path: a console error
   * on every render of a working splat route. Dropping it here rather than
   * special-casing the report keeps "what was left over" meaning what it says.
   */
  if ("*" in missingParamKeys && "_splat" in missingParamKeys) {
    delete missingParamKeys["*"];
  }
  for (const part of parsedPattern ?? []) {
    if (part.type === "literal") {
      fullPathParts.push(part.name);
    } else if (part.type === "array-param" || part.type === "string-param") {
      const key = part.paramName;
      const value = resolvedParams?.[key as keyof typeof resolvedParams] as
        | string
        | string[]
        | undefined;
      if (
        part.type === "string-param" &&
        part.optional &&
        (value === undefined || value === null)
      ) {
        // An optional segment the URL left out (`{-$locale}`): it contributes
        // nothing to the key, so `/about` is the key for `{ locale: undefined }`.
        delete missingParamKeys[key as keyof typeof missingParamKeys];
      } else if (
        part.type === "array-param" &&
        part.optional &&
        (value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0))
      ) {
        // A splat with nothing in it: `/docs` on a `docs.$` route, which
        // TanStack hands over as an empty `_splat`. The directory's own page,
        // so its key is `/docs` -- not `/docs/`, which no one wrote.
        delete missingParamKeys[key as keyof typeof missingParamKeys];
        if ("*" in missingParamKeys) {
          delete missingParamKeys["*"];
        }
      } else if (typeof value !== "string" && !Array.isArray(value)) {
        missingPatterns.push(part);
      } else if (Array.isArray(value)) {
        if (missingParamKeys?.[key as keyof typeof missingParamKeys]) {
          delete missingParamKeys[key as keyof typeof missingParamKeys];
        }
        fullPathParts.push(value.join("/"));
      } else {
        if (missingParamKeys?.[key as keyof typeof missingParamKeys]) {
          delete missingParamKeys[key as keyof typeof missingParamKeys];
        }
        fullPathParts.push(value);
      }
    }
  }
  const lastPattern = missingPatterns?.[missingPatterns.length - 1];
  const isLastOptional =
    lastPattern && lastPattern.type === "array-param" && lastPattern.optional;
  if (isLastOptional) {
    // We **think** that if the last pattern is optional we might still want to match
    // An example: /some-path/[[...test]]
    // Or even: /[[...path]]
    // We believe there's no other legal ways to have optional patterns? Right?
    missingPatterns.pop();
  }

  if (missingPatterns.length > 0) {
    const errorMessageParams = missingPatterns.map((part) => {
      if (part.type === "literal") {
        return part.name;
      } else if (part.type === "string-param") {
        if (part.optional) {
          return `[[${part.paramName}]]`;
        }
        return `[${part.paramName}]`;
      } else if (part.type === "array-param") {
        if (part.optional) {
          return `[[...${part.paramName}]]`;
        }
        return `[...${part.paramName}]`;
      }
    });
    Internal.log.error(
      `${methodName} could not find route since parameters: ${errorMessageParams.join(", ")} where not provided. Make sure the Val module is named after the route file it belongs to, e.g. /src/routes/posts.$postId.val.ts next to /src/routes/posts.$postId.tsx.`,
    );
    return null;
  }
  if (Object.keys(missingParamKeys).length > 0) {
    Internal.log.error(
      `${methodName} could not find route since parameters: ${Object.keys(missingParamKeys).join(", ")} where not found in the path of: ${moduleFilePath}. Make sure ${moduleFilePath} is named after the route file it belongs to.`,
    );
    // We do not return null here since we found a route that matches the path
    // though chances are that there's something wrong in the way ${methodName} is used
  }
  const fullPath = fullPathParts.join("/");
  return `/${fullPath}`;
}

export function initValRouteFromVal(
  resolvedParams: Record<string, string | string[]> | unknown,
  methodName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  path: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  val: any,
) {
  const url = getValRouteUrlFromVal(
    resolvedParams,
    methodName,
    path,
    schema,
    val,
  );
  if (!url) {
    return null;
  }
  const actualRoute = val[url];
  if (!actualRoute) {
    return null;
  }
  return actualRoute;
}
