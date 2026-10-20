/**
 * The source paths in a `data-val-path` attribute.
 *
 * One element can show several pieces of content, and `attrs()` and
 * `autoTagJSX` join their paths with commas. Core's `splitJoinedSourcePaths`
 * splits on every comma, which cuts a path whose record key holds one
 * (`"/blog/a,b"`). This splits only on commas outside the JSON strings a
 * module path is made of, so it agrees with core wherever core is right and
 * keeps such a path whole. It is here rather than imported because nothing in
 * this directory may import core -- see `beacon.ts`.
 */
export function splitValPaths(attribute: string | null): string[] {
  if (!attribute) {
    return [];
  }
  const paths: string[] = [];
  let current = "";
  let inString = false;
  let escaped = false;
  for (const char of attribute) {
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      current += char;
      continue;
    }
    if (char === ",") {
      if (current) {
        paths.push(current);
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current) {
    paths.push(current);
  }
  return paths;
}
