import { readFileFromFile } from "./readFile";
import type { MediaBytes } from "./renameMediaFile";

/**
 * Read a file's bytes back from the URL the Studio shows it at.
 *
 * Mode-agnostic on purpose: a published local file is served by the site, a
 * draft by `/api/val/files?patch_id=…`, and both are the same `fetch` in `fs`
 * and `http` mode. Hashed the same way an upload is (`readFileFromFile`), so a
 * renamed file keeps exactly the hash suffix it was uploaded with.
 *
 * `mimeType` is the type Val recorded for the file. It labels the data URL —
 * a server that sends `application/octet-stream` should not change what the
 * upload says it is — and it is what catches the one failure that does not
 * look like one: `next dev` answers a path it has no file for with the app's
 * HTML and a 200, so a "successful" fetch can be a web page.
 */
export async function fetchMediaBytes(
  url: string,
  filename: string,
  mimeType: string | undefined,
): Promise<{ status: "ok"; bytes: MediaBytes } | FetchMediaError> {
  const fetched = await fetchMediaBlob(url, filename, mimeType);
  if (fetched.status === "error") {
    return fetched;
  }
  try {
    const type = mimeType ?? fetched.blob.type;
    const read = await readFileFromFile(
      new File([fetched.blob], filename, { type }),
    );
    return {
      status: "ok",
      bytes: { dataUrl: read.src, sha256: read.fileHash },
    };
  } catch {
    return { status: "error", message: `Could not read ${filename}.` };
  }
}

/**
 * Why a file could not be read. `notFound`: it is not there, so reading it
 * again cannot help, and a caller should not offer to.
 */
export type FetchMediaError = {
  status: "error";
  message: string;
  notFound?: true;
};

/**
 * The fetch, and the checks that tell a file from something else answering
 * at its URL, without reading it as a data URL: what `fetchMediaBytes` does
 * first, and all a video's reader needs (`useUploadLocalMedia`), which wants
 * the raw bytes of every file of a stream.
 */
export async function fetchMediaBlob(
  url: string,
  filename: string,
  mimeType: string | undefined,
): Promise<{ status: "ok"; blob: Blob } | FetchMediaError> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return {
      status: "error",
      message: `Could not read ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    return {
      status: "error",
      message: `Could not read ${filename} (HTTP ${res.status}).`,
      ...(res.status === 404 || res.status === 410 ? { notFound: true } : {}),
    };
  }
  const servedAs = res.headers.get("content-type") ?? "";
  if (servedAs.startsWith("text/html") && mimeType !== "text/html") {
    return {
      status: "error",
      message: `Could not read ${filename}: the server answered with a web page instead of the file.`,
    };
  }
  try {
    // Inside the `try`: `fetch` resolves on the headers, and a body that is
    // cut off after them rejects HERE. Uncaught, the promised result became a
    // rejection, and the rename input sat in its saving state forever.
    return { status: "ok", blob: await res.blob() };
  } catch {
    return { status: "error", message: `Could not read ${filename}.` };
  }
}
