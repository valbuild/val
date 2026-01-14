import { fixCapitalization } from "./fixCapitalization";

/**
 * Prettifies a filename or path segment for display in the UI.
 * Handles Next.js route naming conventions:
 * - `[[...slug]]` → "…" (optional catch-all - horizontal ellipsis)
 * - `[...slug]` → "…" (catch-all - horizontal ellipsis)
 * - `[id]` → "Id" (dynamic segment - just the parameter name)
 * - `(marketing)` → "Marketing" (route group - without parentheses)
 */
export function prettifyFilename(filename: string): string {
  // Strip .val.ts/.val.js extension first
  let name = filename;
  if (name.endsWith(".val.ts")) {
    name = name.slice(0, -".val.ts".length);
  } else if (name.endsWith(".val.js")) {
    name = name.slice(0, -".val.js".length);
  }

  // Handle Next.js route group folders like (marketing)
  // Strip parentheses and prettify the name
  const routeGroupMatch = name.match(/^\(([^)]+)\)$/);
  if (routeGroupMatch) {
    return fixCapitalization(routeGroupMatch[1]);
  }

  // Handle optional catch-all routes like [[...slug]]
  const optionalCatchAllMatch = name.match(/^\[\[\.\.\.([^\]]+)\]\]$/);
  if (optionalCatchAllMatch) {
    return "…";
  }

  // Handle catch-all routes like [...slug]
  const catchAllMatch = name.match(/^\[\.\.\.([^\]]+)\]$/);
  if (catchAllMatch) {
    return "…";
  }

  // Handle dynamic routes like [id]
  const dynamicMatch = name.match(/^\[([^\]]+)\]$/);
  if (dynamicMatch) {
    return fixCapitalization(dynamicMatch[1]);
  }

  return fixCapitalization(name);
}
