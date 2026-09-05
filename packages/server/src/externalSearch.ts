import type { Json, ModuleFilePath } from "@valbuild/core";

/**
 * Searching an external record when the store will not, and correcting it when
 * the store will.
 *
 * Two halves, and they exist for opposite reasons.
 *
 * **The derived index** answers when an adapter omits `search`. It is
 * deliberately opportunistic: it indexes the entries Val has ALREADY fetched for
 * some other reason, and fetches nothing of its own. Searching a 100,000-entry
 * store must not quietly become "download the store", so the honest answer is a
 * real result over an incomplete corpus, labelled `partial`. An adapter that
 * cannot bear that says `search: false` and the editor is told search is
 * unavailable — which is a different thing from no matches, and is shown
 * differently.
 *
 * **The draft overlay** corrects what a store returns. A delegated search sees
 * PUBLISHED content only, so on its own it finds text an unpublished edit
 * removed and misses text an unpublished edit added. Both are wrong in a way an
 * editor notices immediately: they search for the words they just typed.
 */

export type ExternalHit = {
  key: string;
  /** Where it matched, relative to the item. Absent when the store did not say. */
  path?: string[];
  content?: Json;
};

/**
 * Every string inside a JSON value, with the path it sits at.
 *
 * Keys are not searched, only values: an editor searching for "title" means the
 * word in the text, not the field it lives in.
 */
function* strings(
  value: Json,
  path: string[] = [],
): Generator<{ path: string[]; text: string }> {
  if (typeof value === "string") {
    yield { path, text: value };
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* strings(value[i], path.concat(String(i)));
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      yield* strings(child as Json, path.concat(key));
    }
  }
}

/** Where `text` first occurs in `content`, or `null`. */
export function matchPath(content: Json, text: string): string[] | null {
  const needle = text.toLowerCase();
  if (needle === "") {
    return null;
  }
  for (const { path, text: haystack } of strings(content)) {
    if (haystack.toLowerCase().includes(needle)) {
      return path;
    }
  }
  return null;
}

/**
 * What Val has seen of each external record, so a search can answer from it.
 *
 * Bounded, and bounded by DROPPING rather than by refusing to grow: an index
 * that stops accepting entries would answer worse the longer a session ran. The
 * oldest entries go first, which for the Studio means the pages an editor has
 * scrolled past rather than the one they are on.
 */
export class ExternalSearchIndex {
  private readonly seen = new Map<ModuleFilePath, Map<string, Json>>();

  constructor(private readonly maxEntriesPerModule = 5000) {}

  /**
   * Remember entries that were fetched for some other reason.
   *
   * Called from the read path, never on its own behalf — that is the whole
   * meaning of "opportunistic".
   */
  record(
    moduleFilePath: ModuleFilePath,
    entries: { key: string; content: Json | null }[],
  ): void {
    let module = this.seen.get(moduleFilePath);
    if (module === undefined) {
      module = new Map();
      this.seen.set(moduleFilePath, module);
    }
    for (const { key, content } of entries) {
      if (content === null) {
        module.delete(key);
        continue;
      }
      // Re-insert so a re-read counts as recent: Map preserves insertion order,
      // and deleting first is what moves an existing key to the end.
      module.delete(key);
      module.set(key, content);
    }
    while (module.size > this.maxEntriesPerModule) {
      const oldest = module.keys().next();
      if (oldest.done) {
        break;
      }
      module.delete(oldest.value);
    }
  }

  /** Drop what is remembered of a module — a publish, or a store that moved. */
  forget(moduleFilePath: ModuleFilePath): void {
    this.seen.delete(moduleFilePath);
  }

  entries(moduleFilePath: ModuleFilePath): { key: string; content: Json }[] {
    const module = this.seen.get(moduleFilePath);
    if (module === undefined) {
      return [];
    }
    return [...module.entries()].map(([key, content]) => ({ key, content }));
  }

  size(moduleFilePath: ModuleFilePath): number {
    return this.seen.get(moduleFilePath)?.size ?? 0;
  }
}

/**
 * Search a set of entries Val already holds.
 *
 * The cursor is an index into the matches, not into the store: there is no store
 * involved, and an editor paging through partial results still expects paging to
 * work.
 */
export function searchEntries(
  entries: { key: string; content: Json }[],
  text: string,
  args: { cursor: string | null; limit: number },
): { hits: ExternalHit[]; cursor: string | null } {
  const from = args.cursor === null ? 0 : Number(args.cursor);
  const start = Number.isFinite(from) && from > 0 ? from : 0;
  const matches: ExternalHit[] = [];
  for (const { key, content } of entries) {
    const path = matchPath(content, text);
    if (path !== null) {
      matches.push({ key, path, content });
    }
  }
  const page = matches.slice(start, start + args.limit);
  const next = start + page.length;
  return { hits: page, cursor: next < matches.length ? String(next) : null };
}

/**
 * Correct a delegated search with the unpublished edits it could not see.
 *
 * `patched` is the draft content of every entry that a pending patch touches,
 * plus the draft content of each returned hit. Two corrections, and the second
 * is the one a store cannot make on its own:
 *
 * - A hit whose draft no longer contains the text is DROPPED. The editor deleted
 *   those words; finding the row by them would be a lie about the current state.
 * - An entry whose draft now contains the text is ADDED, even though the store
 *   has never seen it. This is why a draft-added entry is findable at all.
 */
export function overlayDraftOnSearch(args: {
  hits: ExternalHit[];
  text: string;
  /** Draft content by key: `null` for an entry a draft deleted. */
  patched: Record<string, Json | null>;
}): ExternalHit[] {
  const { hits, text, patched } = args;
  const out: ExternalHit[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    seen.add(hit.key);
    if (!(hit.key in patched)) {
      // Untouched by any draft, so the store's answer stands.
      out.push(hit);
      continue;
    }
    const draft = patched[hit.key];
    if (draft === null) {
      continue;
    }
    const path = matchPath(draft, text);
    if (path === null) {
      continue;
    }
    out.push({ key: hit.key, path, content: draft });
  }
  for (const [key, draft] of Object.entries(patched)) {
    if (seen.has(key) || draft === null) {
      continue;
    }
    const path = matchPath(draft, text);
    if (path !== null) {
      out.push({ key, path, content: draft });
    }
  }
  return out;
}
