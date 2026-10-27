import { useCallback } from "react";
import { useValSystem } from "../stores/react/SystemContext";

/**
 * Search, for the AI's `search_content` tool.
 *
 * ## What this replaced
 *
 * A second search worker. This hook used to create its own `Worker`, subscribe
 * to every schema and every source, rebuild the whole index whenever either
 * changed, and hold its own request/response bookkeeping — about 130 lines, all
 * of it a duplicate of what the Studio's own search already did in a different
 * worker. Two indexes of one project, each rebuilt on every keystroke anywhere.
 *
 * The store system has one search store, in the worker realm, and building the
 * index is demand-driven: `system.search` indexes first if the index is missing
 * or stale, so the QUERY pays rather than every edit. That is also why there is
 * no `useEffect` here — nothing to set up, and nothing to tear down.
 */
export function useAISearch() {
  const val = useValSystem();

  const query = useCallback(
    async (
      searchQuery: string,
      limit?: number,
      offset?: number,
    ): Promise<
      { results: { path: string; label: string }[]; total: number } | undefined
    > => {
      if (val === null) {
        return undefined;
      }
      const result = await val.system.search(searchQuery, limit, offset);
      if (result.status === "no-index") {
        // Only when the project has nothing indexable at all — `system.search`
        // builds the index before it queries. An empty result is the honest
        // answer, and it is not an error the AI should be told to retry.
        return { results: [], total: 0 };
      }
      return { results: result.results, total: result.total };
    },
    [val],
  );

  return { query };
}
