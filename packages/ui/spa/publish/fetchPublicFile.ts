/**
 * Where the live site is, from this page's address.
 *
 * The Studio runs on the site, so this page's origin is usually the site's.
 * Not on a proposal's preview: its address is `<proposal>--<project>.<domain>`
 * (a 20-hex proposal name, then the project: `proposalRule.ts` in the
 * loader), which serves the PROPOSAL's build -- so its `/_app/app.css` is the
 * proposal's own stylesheet, empty once a build of it came out without one,
 * and carrying that forward made every rebuild of it empty too. The site is
 * the same address with the project's label.
 *
 * `null` for a bare `<proposal>` label, the address from before projects were
 * in it, which does not say whose proposal it is.
 */
export function siteOriginOf(location: {
  protocol: string;
  host: string;
}): string | null {
  const [label, ...rest] = location.host.split(".");
  if (label === undefined) return null;
  if (/^[0-9a-f]{20}$/.test(label)) return null;
  const proposal = /^[0-9a-f]{20}--([a-z0-9][a-z0-9-]*[a-z0-9])$/.exec(label);
  if (proposal === null) return `${location.protocol}//${location.host}`;
  return `${location.protocol}//${[proposal[1], ...rest].join(".")}`;
}

type PageLocation = { protocol: string; host: string; origin: string };

/**
 * A URL of the live site's, and how to ask for it: this origin's own path
 * with its cookies, or the site's address with none -- the site serves its
 * stylesheet and public files to anyone (`loadableAnywhere` in the loader).
 */
function onTheSite(
  path: string,
  location: PageLocation | undefined,
): { url: string; credentials: RequestCredentials } {
  const relative = `/${path.replace(/^\/+/, "")}`;
  if (location === undefined) {
    return { url: relative, credentials: "same-origin" };
  }
  const site = siteOriginOf(location);
  if (site === null) {
    throw new Error(
      "This page's address does not say which site it is a proposal of, so the live site's files could not be read. " +
        "Open the proposal from the site's Studio and try again.",
    );
  }
  return site === location.origin
    ? { url: relative, credentials: "same-origin" }
    : { url: `${site}${relative}`, credentials: "omit" };
}

/** The page's location, where there is one: a test or a worker has none. */
const pageLocation = (): PageLocation | undefined =>
  typeof location === "undefined" ? undefined : location;

/**
 * One of the live site's public files, base64.
 *
 * For `runStudioDeploy`'s fallback, when content has no record of the live
 * build's public files and the loader names their paths: read from the site
 * (`siteOriginOf`), so `/favicon.ico` is the file the site serves. Base64
 * because that is what a build takes public files as.
 *
 * `cache: "no-store"` because the answer is the file the LIVE build serves,
 * and a cached copy from an earlier build is a different file under the same
 * name.
 */
export async function fetchPublicFile(
  path: string,
  fetchImpl: typeof fetch = fetch,
  location: PageLocation | undefined = pageLocation(),
): Promise<string> {
  const { url, credentials } = onTheSite(path, location);
  const res = await fetchImpl(url, { credentials, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`the site answered ${res.status}`);
  }
  return toBase64(new Uint8Array(await res.arrayBuffer()));
}

/** In slices, because `String.fromCharCode(...bytes)` overflows the stack on an image. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const slice = 0x8000;
  for (let i = 0; i < bytes.length; i += slice) {
    binary += String.fromCharCode(...bytes.subarray(i, i + slice));
  }
  return btoa(binary);
}

/**
 * The live site's compiled stylesheet, or `""` when the site has none.
 *
 * A build in the browser builds from the source Val stores, which holds no
 * stylesheets, so it ships the live site's (`liveStylesheet` on
 * `runStudioDeploy`). Read from the site (`siteOriginOf`), never from a
 * proposal's own address.
 *
 * Only a 404 is "none". Any other failure throws rather than answering `""`:
 * an empty answer ships the site unstyled, which is worse than a publish that
 * stops and says why.
 */
export async function fetchLiveStylesheet(
  fetchImpl: typeof fetch = fetch,
  location: PageLocation | undefined = pageLocation(),
): Promise<string> {
  const { url, credentials } = onTheSite("_app/app.css", location);
  const res = await fetchImpl(url, { credentials, cache: "no-store" });
  if (res.status === 404) return "";
  if (!res.ok) {
    throw new Error(
      `The live site's stylesheet could not be read (the site answered ${res.status}), so the site was not published without it. Try again.`,
    );
  }
  return res.text();
}
