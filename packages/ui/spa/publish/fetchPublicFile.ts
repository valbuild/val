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

/**
 * The `.val.ts` text of every module changed since the running build, from
 * this server's `/built-source`, or `null` when it has none to give.
 *
 * `null` for a 409 (a project with a repository, or a build that did not embed
 * its source) and a 404 (a server that predates the route): the build then
 * falls back to the files the save itself wrote, which is what it did before.
 * Anything else is a failure, because building without it ships a site missing
 * edits that were saved.
 */
export async function fetchBuiltSource(
  api: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string | null> | null> {
  const res = await fetchImpl(`${api.replace(/\/+$/, "")}/built-source`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 409 || res.status === 404) return null;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : `${res.status}`;
    throw new Error(
      `The edits saved since the live build could not be read: ${message}`,
    );
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("files" in body) ||
    typeof body.files !== "object" ||
    body.files === null
  ) {
    throw new Error(
      "The edits saved since the live build came back unreadable.",
    );
  }
  const files: Record<string, string | null> = {};
  for (const [path, text] of Object.entries(body.files)) {
    if (typeof text === "string" || text === null) files[path] = text;
  }
  return files;
}

/**
 * The live site's compiled stylesheet, from this origin, or `""` for none.
 *
 * A build in the browser cannot always compile the project's CSS -- Tailwind
 * `@plugin`s need a module loader it does not have -- and a Studio save never
 * changes a stylesheet or a component, so the live one is still the right one.
 */
export async function fetchLiveStylesheet(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl("/_app/app.css", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) return "";
  return res.text();
}
