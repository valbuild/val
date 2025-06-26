export type RoutePattern =
  | {
      type: "literal";
      name: string;
    }
  | { type: "string-param"; paramName: string; optional: boolean }
  | { type: "array-param"; paramName: string; optional: boolean };
export function parseRoutePattern(pattern: string): RoutePattern[] {
  if (pattern === "" || pattern === "/") {
    return [];
  }
  const p = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  return p.split("/").map((part) => {
    const isOptionalParam = part.startsWith("[[") && part.endsWith("]]");
    const isNonOptionalParam = part.startsWith("[") && part.endsWith("]");
    const nameStart = isOptionalParam ? 2 : isNonOptionalParam ? 1 : 0;
    const nameEnd = part.indexOf("]", nameStart);
    const isArrayParam = part.slice(nameStart, nameStart + 3) === "...";
    const paramName = part.slice(nameStart + (isArrayParam ? 3 : 0), nameEnd);
    if (isOptionalParam || isNonOptionalParam) {
      if (isArrayParam) {
        return { type: "array-param", paramName, optional: isOptionalParam };
      } else {
        return { type: "string-param", paramName, optional: isOptionalParam };
      }
    }
    return { type: "literal", name: part };
  });
}
