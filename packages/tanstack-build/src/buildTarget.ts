/**
 * What a build is targeting, fetched from the platform.
 *
 * One implementation, because there used to be two calls and everybody made
 * them by hand: `/__api/artifacts` for the base revision and `/__api/vendor`
 * for the project's layer, assembled at eighteen call sites. Two calls to
 * build one answer is also two chances to assemble a mismatched one -- a base
 * from after a deploy with a project layer built against the one before it.
 *
 * In THIS package, beside the `BuildInput.target` it produces, because the
 * callers that have to ask are the ones that carry the builder: a CLI on npm
 * and a Studio in a tab, neither of which can be given the answer at compile
 * time. `@valbuild/contract` would be the other candidate and is deliberately
 * types-only -- a user app must not need a runtime import from the platform.
 *
 * The route is no longer public. It says what a project depends on, which was
 * readable by anyone; it now takes the project's own `VAL_API_KEY`, or the
 * operator token, or nothing at all when the loader is running with
 * `CONTROL_PLANE_AUTH: open` -- which is how `wrangler dev` runs and why the
 * suites need no credential.
 *
 * NOT a project token, which the loader refuses on every route but
 * `/__api/publish`. A publisher that holds one asks content's
 * `GET /v1/build-target` instead, which resolves the project from the token
 * and asks the loader with the project's api key.
 */
import type { BuildTarget, BuildTargetRev } from "./contract";

export interface BuildTargetRequest {
  loader: string;
  /** Which project's layer to report. The base half is the same for all. */
  project: string;
  /** The project's api key or the operator token, when the loader wants one. */
  token?: string;
}

const headersFor = (request: BuildTargetRequest) => ({
  "x-platform-project": request.project,
  ...(request.token ? { authorization: `Bearer ${request.token}` } : {}),
});

const endpoint = (request: BuildTargetRequest, query = "") =>
  `${request.loader.replace(/\/+$/, "")}/__api/build-target${query}`;

export async function fetchBuildTarget(
  request: BuildTargetRequest,
): Promise<BuildTarget> {
  const res = await fetch(endpoint(request), { headers: headersFor(request) });
  if (!res.ok) {
    throw new Error(
      `the platform would not say what to build against: ${res.status} ` +
        `${(await res.text()).slice(0, 200)}`,
    );
  }
  return (await res.json()) as BuildTarget;
}

/**
 * Just this project's layer revision.
 *
 * The one question a publisher asks before it has built anything -- must I
 * send my dependency layer at all -- and the full answer reads the whole layer
 * out of storage for its specifier map, which is several megabytes to
 * establish a string comparison.
 */
export async function fetchBuildTargetRev(
  request: BuildTargetRequest,
): Promise<string | null> {
  const res = await fetch(endpoint(request, "?only=rev"), {
    headers: headersFor(request),
  });
  if (!res.ok) return null;
  return ((await res.json()) as BuildTargetRev).project.rev;
}
