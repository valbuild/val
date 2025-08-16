import { ModuleFilePath, Internal, RecordSchema } from "@valbuild/core";
import {
  getNextAppRouterSourceFolder,
  getPatternFromModuleFilePath,
  parseRoutePattern,
  RoutePattern,
} from "@valbuild/shared/internal";

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
    console.error(
      `Val: ${methodName} can only be used with a Val module (details: no Val path found).`,
    );
    return null;
  }
  if (val === null) {
    return null;
  }
  if (typeof val !== "object") {
    console.error(
      `Val: ${methodName} must be used with a Val Module that is a s.record().router(...) (details: expected type object, found ${typeof val} instead).`,
    );
    return null;
  }
  if (Array.isArray(val)) {
    console.error(
      `Val: ${methodName} must be used with a Val Module that is a s.record().router(...) (details: expected type object, found array instead).`,
    );
    return null;
  }
  if (!schema) {
    console.error(
      `Val: ${methodName} must be used with a Val Module that is a s.record().router(...) (details: no schema found).`,
    );
    return null;
  }
  if (!(schema instanceof RecordSchema)) {
    console.error(
      `Val: ${methodName} must be used with a Val Module that is a s.record().router(...) (details: schema is not a record).`,
    );
  } else if (!schema["currentRouter"]) {
    console.error(
      `Val: ${methodName} must be used with a Val Module that is a s.record().router(...) (details: router is not set).`,
    );
  } else if (
    schema["currentRouter"].getRouterId() !==
    Internal.nextAppRouter.getRouterId()
  ) {
    console.error(
      `Val: ${methodName} must be used with a Val Module that is a s.record().router(...) (details: router is not the Next.js App Router).`,
    );
    return null;
  }
  if (typeof resolvedParams !== "object") {
    console.error(
      `Val: ${methodName} must be used with a Val Module that is a s.record().router(...) (details: params is not an object).`,
    );
    return null;
  }
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (
    !(
      moduleFilePath.endsWith("page.val.ts") ||
      moduleFilePath.endsWith("page.val.js")
    )
  ) {
    console.error(
      `Val: ${methodName} is used with a Val module that does not have a page.val.ts or page.val.js file. Make sure the Val module is in the same directory as your page.tsx or page.js file.`,
    );
    return null;
  }
  const srcFolder = getNextAppRouterSourceFolder(
    moduleFilePath as ModuleFilePath,
  );
  if (!srcFolder) {
    console.error(
      `Val: ${methodName} was used with a Val module that is not in the /app or /src/app folder`,
    );
    return null;
  }
  const pattern = getPatternFromModuleFilePath(moduleFilePath, srcFolder);
  const parsedPattern = parseRoutePattern(pattern);
  const missingPatterns: RoutePattern[] = [];
  const fullPathParts: string[] = [];
  const missingParamKeys = resolvedParams ? { ...resolvedParams } : {};
  for (const part of parsedPattern ?? []) {
    if (part.type === "literal") {
      fullPathParts.push(part.name);
    } else if (part.type === "array-param" || part.type === "string-param") {
      const key = part.paramName;
      const value = resolvedParams?.[key as keyof typeof resolvedParams] as
        | string
        | string[]
        | undefined;
      if (typeof value !== "string" && !Array.isArray(value)) {
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
    console.error(
      `Val: ${methodName} could not find route since parameters: ${errorMessageParams.join(", ")} where not provided. Make sure the Val module is in the same directory as your page.tsx or page.js file and that the Val module filename is called page.val.ts or page.val.js.`,
    );
    return null;
  }
  if (Object.keys(missingParamKeys).length > 0) {
    console.error(
      `Val: ${methodName} could not find route since parameters: ${Object.keys(missingParamKeys).join(", ")} where not found in the path of: ${moduleFilePath}. Make sure  ${moduleFilePath} in the same directory as your page.tsx or page.js file.`,
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
