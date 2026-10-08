import { useCallback, useEffect, useMemo, useState } from "react";
import type { Json, ModuleFilePath } from "@valbuild/core";
import { z } from "zod";
import {
  useModuleSourcesNowAndBase,
  usePatchSets,
} from "../components/ValProvider";
import { useSchemas } from "../components/ValFieldProvider";
import type { ChangeTreeNode } from "../utils/computeChangedSourcePaths";
import { toCompareStructure } from "../compare/toCompareStructure";
import { isPageModule } from "../utils/pageRoutes";
import { siteChangeTrees } from "./siteDiff";

/**
 * What a proposal changes on the site, saved and unsaved alike: what Review
 * shows in a proposal, and what Publish -- merging it -- would publish.
 * valbuild/home `docs/proposals.md`, "Compare with the site".
 *
 * The site's Source is asked for ONCE: it is the build the proposal is based
 * on, which does not change while this Studio runs. Everything else is the
 * store, so the changes follow every edit.
 */
export type SiteChanges =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "ready";
      trees: ChangeTreeNode[];
      /** The "before" column, for the modules the proposal changed. */
      siteSources: Partial<Record<ModuleFilePath, Json>>;
      changeCount: number;
    };

const JsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);
// Parsed once, when it arrives, rather than on every edit that re-diffs it.
const Answer = z.object({ modules: z.record(z.string(), JsonValue) });

type Fetched =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; modules: Record<string, Json> };

export function useSiteChanges(inProposal: boolean): SiteChanges {
  const [fetched, setFetched] = useState<Fetched>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!inProposal) return;
    let cancelled = false;
    setFetched({ status: "loading" });
    fetch("/api/val/proposal-site-sources", { credentials: "same-origin" })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => undefined);
        if (!res.ok) {
          throw new Error(
            `The site's content could not be read (${res.status}).`,
          );
        }
        return Answer.parse(body).modules;
      })
      .then(
        (modules) => {
          if (!cancelled) setFetched({ status: "ready", modules });
        },
        (error: unknown) => {
          if (!cancelled) {
            setFetched({
              status: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "The site's content could not be read.",
            });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [inProposal, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // The modules to compare: those the proposal saved, and those with edits
  // that are not saved yet.
  const patchSets = usePatchSets();
  const moduleFilePaths = useMemo<ModuleFilePath[]>(() => {
    if (fetched.status !== "ready") return [];
    const paths = new Set<string>(Object.keys(fetched.modules));
    if (patchSets.status === "success") {
      for (const patchSet of patchSets.data) paths.add(patchSet.moduleFilePath);
    }
    return [...paths].sort().map(asModuleFilePath);
  }, [fetched, patchSets]);
  const sources = useModuleSourcesNowAndBase(moduleFilePaths);
  const schemas = useSchemas();

  return useMemo<SiteChanges>(() => {
    if (!inProposal) return { status: "off" };
    if (fetched.status === "error") {
      return { status: "error", message: fetched.message, retry };
    }
    if (
      fetched.status === "loading" ||
      sources === null ||
      schemas.status !== "success"
    ) {
      return { status: "loading" };
    }
    const siteSources: Partial<Record<ModuleFilePath, Json>> = {};
    const trees = siteChangeTrees(
      moduleFilePaths.map((moduleFilePath) => {
        // Saved in the proposal: the site's own. Otherwise the base, which
        // is the site's for every module the proposal has not saved.
        const site =
          moduleFilePath in fetched.modules
            ? fetched.modules[moduleFilePath]
            : sources.base[moduleFilePath];
        if (site !== undefined) siteSources[moduleFilePath] = site;
        return {
          moduleFilePath,
          site,
          now: sources.now[moduleFilePath],
          schema: schemas.data[moduleFilePath],
        };
      }),
    );
    const { changeCount } = toCompareStructure({
      trees,
      isPageModule: (moduleFilePath) =>
        isPageModule(schemas.data[moduleFilePath]),
    });
    return { status: "ready", trees, siteSources, changeCount };
  }, [inProposal, fetched, sources, schemas, moduleFilePaths, retry]);
}

function asModuleFilePath(path: string): ModuleFilePath {
  // Keys of a module map ARE module file paths: the server sends them by one.
  return path as ModuleFilePath;
}
