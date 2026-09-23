/**
 * One of the live site's public files, base64, read from this origin.
 *
 * For `runStudioDeploy`'s fallback, when content has no record of the live
 * build's public files and the loader names their paths: the Studio runs ON
 * the site, so `/favicon.ico` here is the file the site serves. Base64 because
 * that is what a build takes public files as.
 *
 * `cache: "no-store"` because the answer is the file the LIVE build serves,
 * and a cached copy from an earlier build is a different file under the same
 * name.
 */
export async function fetchPublicFile(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`/${path.replace(/^\/+/, "")}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
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
