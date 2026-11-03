import { useEffect, useMemo, useState } from "react";
import { createStudioPublishClient } from "@valbuild/shared/publish";
import { createProposalsClient } from "../../proposals/proposalsClient";
import { useProposalBuild } from "../../proposals/useProposalBuild";
import { changedFiles, type ChangedFile } from "../../design/changedFiles";
import { lineDiff, type DiffLine } from "../../design/lineDiff";
import { previewUrl } from "../../design/designTabUrl";
import { CodeModeWorkspace, type CodeModeBuild } from "./CodeModeWorkspace";

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
 * Code mode's workspace, in the Studio at the proposal's own address: the
 * proposal's site in a frame at this address -- served from its last build,
 * so it shows the code as it is now -- and what it changes of the site's
 * files, read again whenever the code moves (a staging, a build).
 *
 * Shown in place of the editor and the canvas to the person whose view is
 * code mode's (`CodeModeView`); everyone else in the proposal keeps the
 * content editor.
 */
export function CodeModeWorkspaceConnected({
  name,
  build,
  pages,
  initialRoute,
}: {
  /** The proposal this Studio is in. */
  name: string;
  build: CodeModeBuild;
  /** The site's pages, to choose from. */
  pages: string[];
  initialRoute: string;
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

  // Once per file and read, as the design tab does: a diff can be large.
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

  const [route, setRoute] = useState(initialRoute);
  const [reloadKey, setReloadKey] = useState(0);
  // A build served is a new page at this address: shown without a reload.
  useEffect(() => {
    setReloadKey((key) => key + 1);
  }, [changed]);
  const src = previewUrl(window.location.origin, route);
  const choices = pages.includes(route) ? pages : [route, ...pages];
  return (
    <CodeModeWorkspace
      route={route}
      pages={choices}
      onRouteChange={setRoute}
      onReload={() => setReloadKey((key) => key + 1)}
      preview={
        src === null ? (
          <p className="p-6 text-sm text-fg-secondary">
            {route} is not a page of this site.
          </p>
        ) : (
          <iframe
            key={reloadKey}
            src={src}
            title="The proposal's preview"
            className="h-full w-full border-0"
          />
        )
      }
      build={build}
      files={read.status === "ready" ? read.files : []}
      diffOf={diffOf}
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
