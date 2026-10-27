/**
 * The asset a chunk's RELATIVE import names, when that chunk is served at
 * `/{VERSION}/app`.
 *
 * The Studio's main chunk is emitted as `/assets/index-<hash>.js` and served
 * at `/api/val/static/{VERSION}/app`, so the URL the browser resolves its
 * imports against is `/{VERSION}/`, not `/assets/`. Vite writes imports
 * between chunks as relative paths -- `from "./__vite-browser-external-….js"`,
 * `import("./valbuild-tanstack-build.esm-….js")` -- so each of those arrives
 * here as `/{VERSION}/<name>`, which is not a key in the embedded record.
 *
 * While the SPA was one chunk there were no such imports and nothing noticed.
 * The builder made it several, and `@valbuild/ui@0.136.0` shipped a main chunk
 * whose STATIC import of `__vite-browser-external` 404'd into the SPA's HTML
 * fallback: the browser refuses an HTML module script, so the Studio did not
 * boot at all -- in every app, served from the built package. The dev server
 * resolves relative imports itself, which is why no dev-mode test saw it.
 *
 * One path segment only: an emitted chunk sits directly in `/assets/`, and a
 * name with a slash in it is not something a relative import from there could
 * produce.
 */
export function siblingOfApp(
  path: string,
  version: string,
  has: (key: string) => boolean,
): string | null {
  const prefix = `/${version}/`;
  if (!version || !path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  if (name === "" || name.includes("/")) return null;
  const key = `/assets/${name}`;
  return has(key) ? key : null;
}
