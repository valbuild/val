import type { ModuleFilePath } from "@valbuild/core";
import type { HistoricalModule } from "@valbuild/shared/internal";
import { useEffect, useState } from "react";
import { useClient } from "../components/ValProvider";

type ModuleState =
  | { status: "loading" }
  | { status: "success"; module: HistoricalModule | null }
  | { status: "error"; message: string };

/**
 * One module as of a commit, for the modules that commit did not change.
 *
 * The pane gets a commit's own modules from `/history/commit`. That is the
 * narrow case: the moment the editor navigates anywhere else, there is nothing
 * to show, and "this commit did not touch it" is true but useless — the
 * question was how the module looked at that point, not whose commit changed it.
 *
 * `module: null` means history genuinely has no record at or before then, which
 * is the one case that still deserves the note.
 *
 * Cached by the browser: the answer is immutable for a sha, so flipping back to
 * a module costs nothing and there is no store to keep here.
 */
export function useModuleAtCommit(
  commitSha: string | null,
  moduleFilePath: ModuleFilePath | null,
  /** Skip entirely when the commit already carries this module. */
  skip: boolean,
): ModuleState | null {
  const client = useClient();
  const [state, setState] = useState<ModuleState | null>(null);

  useEffect(() => {
    if (!commitSha || !moduleFilePath || skip) {
      setState(null);
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    client("/history/module", "GET", {
      query: { commit_sha: commitSha, module_file_path: moduleFilePath },
    })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 200) {
          setState({ status: "success", module: res.json.module });
        } else {
          setState({
            status: "error",
            message:
              "message" in res.json
                ? res.json.message
                : "This module could not be read at that commit.",
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    // Navigating quickly must not let the first module's answer land on the
    // second module's screen.
    return () => {
      cancelled = true;
    };
  }, [client, commitSha, moduleFilePath, skip]);

  return state;
}
