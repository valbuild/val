/**
 * Where the canvas points when the editor is not on a page.
 *
 * Compare, Errors, a data module, the media panel — none of them names a page,
 * and the canvas still has to point somewhere. The root is the honest default:
 * it is the page every site has and the one an editor recognises.
 *
 * Unless the project does not TRACK the root, which is common enough — a site
 * whose home page is static, or one whose content starts at `/blog`. Loading `/`
 * then puts a page Val knows nothing about on the canvas: no fields, nothing
 * selectable, which reads as the canvas being broken rather than as the page not
 * being Val's. The first route it does track is a page the editor can actually
 * work on, and the route bar above it lists the rest to pick from.
 *
 * `routes` is taken in the order the caller offers them — `ValShell` sorts them
 * for the address bar, so "the first" is the first alphabetically, which is at
 * least a stable answer rather than whatever order the router enumerated.
 */
export function canvasFallbackRoute(routes: readonly string[]): string {
  if (routes.length === 0 || routes.includes("/")) return "/";
  return routes[0];
}
