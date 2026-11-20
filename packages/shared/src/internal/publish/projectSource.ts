import { readJsonByVersion } from "../../publish/callJson";
import { parseProjectSource } from "./protocol";

/**
 * Where content's publish API is reached: through Val's proxy on this origin
 * (`api`, the Studio), or directly (`publishApi`, `<content>/v1`: home's
 * upgrade page, whose `fetchImpl` adds the project token).
 */
export type PublishApiAt =
  | {
      /** Val's API root on this origin, e.g. `/api/val`. */
      api: string;
    }
  | {
      /** Content's publish API itself, e.g. `https://content.val.build/v1`. */
      publishApi: string;
    };

export function publishApiOf(at: PublishApiAt): string {
  return "publishApi" in at
    ? at.publishApi.replace(/\/+$/, "")
    : `${at.api.replace(/\/+$/, "")}/publish-api`;
}

/**
 * The site's live source, BY VERSION: for a reader that asks again and again
 * over a long life -- the Studio's code tools, on every tool call -- rather
 * than once per deploy, as {@link createStudioPublishClient}'s memo does.
 *
 * Each call asks `/project-source` with the `ETag` of the answer it holds
 * (`If-None-Match`), and content answers 304 while it is still that one
 * (valbuild/home sends the tag: the sha256 of its answer). So a publish in
 * between is seen on the next call, and the whole source is sent only when
 * it changed. An answer without a tag (an older content service) is not
 * held: every call reads it again, which is right, if dearer.
 */
export function createProjectSourceReader(
  options: PublishApiAt & { fetchImpl?: typeof fetch },
): () => Promise<Record<string, string> | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${publishApiOf(options)}/project-source`;
  let held: { etag: string; value: Record<string, string> | null } | null =
    null;
  return async () => {
    const answer = await readJsonByVersion(
      fetchImpl,
      url,
      held,
      (body) => parseProjectSource(body).files,
    );
    held =
      answer.etag !== null ? { etag: answer.etag, value: answer.value } : null;
    return answer.value;
  };
}
