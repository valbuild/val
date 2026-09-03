import { useMemo } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { useNavMenuData } from "../NavMenu/useNavMenuData";
import {
  useCommittedPatches,
  useCurrentPatchIds,
  useCurrentProfile,
  useDeployments,
  usePatchSets,
  useProfilesByAuthorId,
  useShallowModulesAtPaths,
} from "../ValProvider";
import { useAllValidationErrors } from "../ValErrorProvider";
import { useValConfig } from "../ValFieldProvider";
import { ShellData, ShellMediaGallery } from "./types";
import {
  toActivity,
  toAdminLinks,
  toDataModules,
  toDeployments,
  toExternalPages,
  toShellPages,
  toValidationErrors,
  initialsOf,
  directoryName,
  countKeys,
  toMediaFiles,
  collectNewPageRoutes,
} from "./shellDataMapping";

export type ShellDataState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "success"; data: ShellData };

/**
 * Builds the shell's data from the real providers.
 *
 * The shell's own types were designed against mock data, so this is where the
 * two meet — and where it becomes visible which of them Val can actually
 * answer. Everything here comes from a provider; anything the shell asks for
 * that has no source is left undefined rather than invented, and the shell
 * hides the affordance instead of showing an empty one.
 */
export function useShellData(): ShellDataState {
  const navMenu = useNavMenuData();
  const config = useValConfig();
  const profile = useCurrentProfile();
  const validationErrors = useAllValidationErrors();
  const patchSets = usePatchSets();
  const currentPatchIds = useCurrentPatchIds();
  const committedPatchIds = useCommittedPatches();
  const { deployments, observedCommitShas } = useDeployments();
  const profilesByAuthorId = useProfilesByAuthorId();

  // Relative times are computed once per feed change rather than per render,
  // so a row does not silently disagree with the one above it.
  const shellDeployments = useMemo(
    () =>
      toDeployments(
        deployments,
        observedCommitShas,
        profilesByAuthorId,
        Date.now(),
      ),
    [deployments, observedCommitShas, profilesByAuthorId],
  );

  const navData = navMenu.status === "success" ? navMenu.data : undefined;

  // External pages and media galleries are both records, so their contents
  // come back in one subscription. The results are aligned to the paths that
  // went in, which is what the slice below relies on.
  const externalPath = navData?.external?.moduleFilePath;
  const mediaPaths = useMemo(
    () => (navData?.media ?? []).map((entry) => entry.moduleFilePath),
    [navData?.media],
  );
  const recordPaths = useMemo(
    (): ModuleFilePath[] =>
      (externalPath ? [externalPath] : []).concat(mediaPaths),
    [externalPath, mediaPaths],
  );
  const records = useShallowModulesAtPaths(recordPaths, "record");

  // Which modules have unpublished work. Patch sets are keyed by module, so
  // one pass gives the draft marker for every row in the navigation.
  const modulesWithDrafts = useMemo((): ReadonlySet<string> => {
    if (patchSets.status !== "success") return new Set();
    return new Set(patchSets.data.map((set) => set.moduleFilePath));
  }, [patchSets]);

  return useMemo((): ShellDataState => {
    if (navMenu.status === "loading") {
      return { status: "loading" };
    }
    if (navMenu.status === "error") {
      return { status: "error", error: navMenu.error };
    }
    const collected = navData?.sitemap
      ? collectNewPageRoutes(navData.sitemap)
      : null;
    const newPageRoutes =
      collected && collected.routes.length > 0
        ? { routes: collected.routes }
        : undefined;
    const recordData = records.status === "success" ? records.data : null;
    const externalRecord = externalPath ? recordData?.[0] : undefined;
    const mediaRecords = recordData?.slice(externalPath ? 1 : 0) ?? [];

    return {
      status: "success",
      data: {
        projectName: config?.project ?? "Val",
        admin: toAdminLinks(config),
        branch: config?.gitBranch,
        hasRouters: navData?.hasRouters ?? false,
        pages: navData?.sitemap
          ? toShellPages(navData.sitemap, modulesWithDrafts)
          : [],
        // Absent rather than empty when nothing accepts a page, so the shell
        // hides the New page buttons instead of opening a form that can only
        // say no.
        newPage: newPageRoutes,
        externalPages: toExternalPages(externalRecord),
        media: (navData?.media ?? []).map(
          (entry, index): ShellMediaGallery => ({
            id: entry.moduleFilePath,
            name: directoryName(entry.directory),
            directory: entry.directory,
            moduleFilePath: entry.moduleFilePath,
            mediaType: entry.mediaType,
            itemCount: countKeys(mediaRecords[index]),
            files: toMediaFiles(mediaRecords[index]),
          }),
        ),
        data: navData?.explorer
          ? toDataModules(navData.explorer, modulesWithDrafts)
          : [],
        validationErrors: toValidationErrors(validationErrors),
        activity:
          patchSets.status === "success"
            ? toActivity(patchSets.data, Date.now())
            : undefined,
        pendingChanges: currentPatchIds.length - committedPatchIds.size,
        deployments: shellDeployments,
        user: profile
          ? {
              name: profile.fullName,
              email: profile.email,
              initials: initialsOf(profile.fullName),
            }
          : undefined,
      },
    };
  }, [
    navMenu,
    navData,
    records,
    externalPath,
    config,
    profile,
    validationErrors,
    patchSets,
    modulesWithDrafts,
    currentPatchIds,
    committedPatchIds,
    shellDeployments,
  ]);
}
