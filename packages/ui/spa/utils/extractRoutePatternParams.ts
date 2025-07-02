import { RoutePattern } from "./parseRoutePattern";

export function extractRoutePatternParams(
  routePattern: RoutePattern[],
  fullUrlPath: string,
):
  | { status: "success"; params: { [paramName: string]: string | string[] } }
  | { status: "error"; message: string } {
  const params: { [paramName: string]: string | string[] } = {};
  const parts = fullUrlPath?.split("/");
  if (parts?.[0] === "") {
    // URL starts with a slash
    parts.shift();
  }

  // Filter out empty parts (consecutive slashes)
  const cleanParts = parts?.filter((part) => part !== "") || [];

  let partIndex = 0;

  for (let i = 0; i < routePattern.length; i++) {
    const patternPart = routePattern[i];

    if (patternPart.type === "literal") {
      const part = cleanParts[partIndex];
      if (!part) {
        return {
          status: "error",
          message: `Missing required literal part: ${patternPart.name}`,
        };
      }
      if (patternPart.name !== part) {
        return {
          status: "error",
          message: `Invalid path part: expected "${patternPart.name}", got "${part}"`,
        };
      }
      partIndex++;
    } else if (patternPart.type === "string-param") {
      const part = cleanParts[partIndex];
      if (!part) {
        if (patternPart.optional) {
          // Optional parameter is missing, skip it
          continue;
        } else {
          return {
            status: "error",
            message: `Missing required parameter: ${patternPart.paramName}`,
          };
        }
      }
      params[patternPart.paramName] = part;
      partIndex++;
    } else if (patternPart.type === "array-param") {
      const remainingParts = cleanParts.slice(partIndex);
      if (remainingParts.length === 0) {
        if (patternPart.optional) {
          // Optional catch-all parameter is missing, skip it
          continue;
        } else {
          return {
            status: "error",
            message: `Missing required catch-all parameter: ${patternPart.paramName}`,
          };
        }
      }
      params[patternPart.paramName] = remainingParts;
      partIndex += remainingParts.length;
    }
  }

  // Check if there are extra parts that weren't consumed
  if (partIndex < cleanParts.length) {
    return {
      status: "error",
      message: `Extra path parts found: ${cleanParts.slice(partIndex).join("/")}`,
    };
  }

  return { status: "success", params };
}
