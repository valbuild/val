/**
 * One value, computed once per REQUEST.
 *
 * `fetchVal` in draft mode reads the whole module tree out of `/sources/~`, and
 * a page that calls it three times used to ask three times — the answer being
 * byte-identical each time, because the query and the session are fixed for the
 * length of a request. This is what makes the second and third call free.
 *
 * ## Why the scope is the REQUEST and can never be wider
 *
 * The memoised response is `own_patch_groups_only: true` — it contains the
 * CALLER'S OWN unpublished work, resolved from their session cookie. A memo
 * that outlived the request would serve one author's staged edits to the next
 * visitor, which is the exact failure `own_patch_groups_only` exists to
 * prevent, and it would be invisible: the draft would simply render somebody
 * else's half-finished sentence.
 *
 * So this module holds NO state of its own. The caller supplies the box, and
 * the box has to come from something the framework already scopes to the
 * request — React's `cache()` in an RSC, a `WeakMap` keyed on the `Request` in
 * TanStack Start. `null` means "no request scope available", and that is not an
 * error: it falls back to computing every time, which is what the code did
 * before this existed. Ineffective is a safe failure here; leaking is not.
 *
 * The `key` is the second half of that guarantee. It carries whatever the
 * answer depends on — the session — so a box that somehow outlived its request,
 * or is shared by two sessions, MISSES rather than serving the wrong draft.
 *
 * ## The promise is cached, not the value
 *
 * React renders siblings concurrently, so three `fetchVal` calls in one page
 * are usually in flight at the same time rather than one after another.
 * Caching the resolved value would dedupe none of them; caching the promise
 * dedupes both orderings.
 */
export type RequestScopedMemo<T> = {
  key?: string;
  promise?: Promise<T>;
};

/**
 * Returns the memoised promise for `key`, computing it only on a miss.
 *
 * A rejection is memoised along with everything else, on purpose: one failed
 * read per request is the same answer for every caller in it, and retrying it
 * two more times only makes a broken draft slower to render.
 */
export function memoizePerRequest<T>(
  box: RequestScopedMemo<T> | null,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  if (box === null) {
    return compute();
  }
  if (box.promise !== undefined && box.key === key) {
    return box.promise;
  }
  const promise = compute();
  box.key = key;
  box.promise = promise;
  return promise;
}
