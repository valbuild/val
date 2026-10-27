// A minimal posix path resolver. The builder runs in the browser, so node:path
// is unavailable, and pulling a polyfill in for two functions is not worth it.

export function dirname(path: string) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

export function resolve(from: string, to: string) {
  const segments = to.startsWith("/") ? [] : from.split("/").filter(Boolean);
  for (const segment of to.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

const EXTENSIONS = [
  "",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  "/index.tsx",
  "/index.ts",
];

/** Resolve a relative import against the in-memory file set. */
export function resolveInFiles(base: string, files: Record<string, string>) {
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (candidate in files) return candidate;
  }
  return null;
}
