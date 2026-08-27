import { useEffect, useMemo, useState } from "react";
import { Internal, SourcePath } from "@valbuild/core";
import { useValSystem } from "../../stores/react/SystemContext";
import { useAllJsonValuesLoad } from "../useJsonValuesLoad";
import { useGetNavPath } from "../ValFieldProvider";
import { SearchResult } from "./GlobalSearch";

/** How many content hits to ask for. Enough to be useful, few enough to read. */
const LIMIT = 20;

export type ContentSearchState = {
  results: SearchResult[];
  /** True while the index is answering, or while there is more to index. */
  isSearching: boolean;
};

/**
 * Search inside the content, as the studio's own search does.
 *
 * The shell's search filters the navigation — page names, module paths — which
 * answers "take me to Pricing" and cannot answer "which page says *asked*".
 * That second question is the one Val has an index for, and this is that index:
 * `system.search`, the same one the old search box and the assistant query.
 *
 * Two things make it more than one call.
 *
 * A `.jsonValues()` module is not fully in the index until its entries have
 * been loaded, and they arrive in batches — so a query answered at 20% is not
 * the final answer, and the query is asked again as the load progresses. The
 * load itself starts on the first real query rather than on mount: opening the
 * search should not pull the whole project down.
 *
 * And several hits can live under one thing the studio can actually show, so
 * they are collapsed to one row per navigable path. Otherwise a page with the
 * word in four fields is four identical-looking rows.
 */
export function useContentSearch(query: string): ContentSearchState {
  const val = useValSystem();
  const getNavPath = useGetNavPath();
  const trimmed = query.trim();
  const hasQuery = trimmed !== "";
  const jsonEntriesLoad = useAllJsonValuesLoad(hasQuery);
  const [found, setFound] = useState<{ path: SourcePath; label: string }[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);

  /**
   * How far the entry load has got, as one value an effect can depend on.
   *
   * A number while loading, a status string otherwise, so the query re-runs as
   * batches land and then stops.
   */
  const loadProgress =
    jsonEntriesLoad.status === "loading"
      ? jsonEntriesLoad.percentage
      : jsonEntriesLoad.status;

  useEffect(() => {
    if (val === null || !hasQuery) {
      setFound([]);
      setIsQuerying(false);
      return;
    }
    let cancelled = false;
    setIsQuerying(true);
    void val.system
      .search(trimmed, LIMIT)
      .then((res) => {
        if (cancelled) return;
        // `no-index` means the project has nothing indexable at all, which is
        // an empty result rather than a failure.
        setFound(res.status === "no-index" ? [] : res.results);
      })
      .catch(() => {
        if (!cancelled) setFound([]);
      })
      .finally(() => {
        if (!cancelled) setIsQuerying(false);
      });
    return () => {
      // A slow answer for "a" must not overwrite the answer for "abc".
      cancelled = true;
    };
  }, [val, trimmed, hasQuery, loadProgress]);

  const results = useMemo((): SearchResult[] => {
    const seen = new Set<string>();
    const rows: SearchResult[] = [];
    for (const hit of found) {
      // One row per thing the studio can open: several hits often resolve to
      // the same field once the nav path is taken.
      const navPath = getNavPath(hit.path) || hit.path;
      if (seen.has(navPath)) continue;
      seen.add(navPath);
      const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
        hit.path,
      );
      rows.push({
        // The hit's own path, not the nav path: opening it should land on the
        // field that matched.
        id: hit.path,
        kind: "content",
        label: hit.label,
        detail: moduleFilePath,
      });
    }
    return rows;
  }, [found, getNavPath]);

  return {
    results,
    // Still filling counts as still searching: the set on screen is not final
    // until the index has everything.
    isSearching:
      hasQuery && (isQuerying || jsonEntriesLoad.status === "loading"),
  };
}
