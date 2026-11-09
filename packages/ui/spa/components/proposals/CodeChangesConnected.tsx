import { useEffect, useMemo, useState } from "react";
import { createStudioPublishClient } from "@valbuild/shared/publish";
import { createProposalsClient } from "../../proposals/proposalsClient";
import { useProposalBuild } from "../../proposals/useProposalBuild";
import { changedFiles, type ChangedFile } from "../../design/changedFiles";
import { lineDiff, type DiffLine } from "../../design/lineDiff";
import { CodeChanges, type CodeModeBuild } from "./CodeChanges";

type Read =
  | { status: "loading" }
  | {
      status: "ready";
      site: Record<string, string>;
      own: Record<string, string | null>;
      files: ChangedFile[];
    }
  | { status: "error"; message: string };

/**
 * {@link CodeChanges}, read from the proposal: what it changes of the site's
 * files, read again whenever the code moves (a staging, a build).
 */
export function CodeChangesConnected({
  name,
  build,
  onReload,
  onEditContent,
}: {
  /** The proposal this Studio is in. */
  name: string;
  build: CodeModeBuild;
  onReload: () => void;
  onEditContent: () => void;
}) {
  const proposals = useMemo(
    () => createProposalsClient({ api: "/api/val" }),
    [],
  );
  const changed = useProposalBuild(proposals).state.changed;
  const [read, setRead] = useState<Read>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // A client per read: one keeps the first answer for the site's source.
        const publish = createStudioPublishClient({ api: "/api/val" });
        const [files, site] = await Promise.all([
          proposals.files(name),
          publish.projectSource(),
        ]);
        if (cancelled) return;
        setRead({
          status: "ready",
          site: site ?? {},
          own: files.files,
          files: changedFiles(site ?? {}, files.files, files.staged.files),
        });
      } catch (error) {
        if (cancelled) return;
        setRead({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, proposals, changed, attempt]);

  // Once per file and read: a diff can be large.
  const diffOf = useMemo(() => {
    const diffs = new Map<string, DiffLine[]>();
    return (path: string): DiffLine[] => {
      if (read.status !== "ready") return [];
      let diff = diffs.get(path);
      if (diff === undefined) {
        diff = lineDiff(read.site[path] ?? null, read.own[path] ?? null);
        diffs.set(path, diff);
      }
      return diff;
    };
  }, [read]);

  return (
    <CodeChanges
      build={build}
      onReload={onReload}
      files={read.status === "ready" ? read.files : []}
      diffOf={diffOf}
      onEditContent={onEditContent}
      filesError={
        read.status === "error"
          ? {
              message: read.message,
              onRetry: () => {
                setRead({ status: "loading" });
                setAttempt((n) => n + 1);
              },
            }
          : null
      }
    />
  );
}
