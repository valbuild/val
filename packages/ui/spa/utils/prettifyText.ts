import { Internal } from "@valbuild/core";

export function fromCamelToTitleCase(text: string): string {
  const result = text.replace(/([A-Z])/g, " $1").toLowerCase();
  return result.charAt(0).toUpperCase() + result.slice(1);
}

export function prettifyModulePath(modulePath: string): string {
  // Show "Home / Title" instead of '"home"."title"'. Router-page slugs like
  // "/blogs/blog-12" start with "/" so the casing helper leaves them intact.
  if (!modulePath) return modulePath;
  // splitModulePath accepts the same string the engine uses internally; it's
  // a branded type at the boundary but the existing helpers are tolerant.
  const segments = Internal.splitModulePath(
    modulePath as Parameters<typeof Internal.splitModulePath>[0],
  );
  return segments.map(fromCamelToTitleCase).join(" / ");
}
