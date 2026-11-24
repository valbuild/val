import { useMemo } from "react";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { localeOfModuleRoot, localeScopeAt } from "@valbuild/shared/internal";
import { useNavMenuData } from "../NavMenu/useNavMenuData";
import {
  useCurrentProfile,
  useCurrentProposal,
  useDeployments,
  useStudioDeployState,
  useModulesWithPatches,
  usePatchSets,
  usePendingChangeCount,
  useProfilesByAuthorId,
  useShallowModulesAtPaths,
  useStudioIsDeployer,
  useValMode,
} from "../ValProvider";
import { sameDeep, useKept } from "../../stores/react/useStoreValue";
import { useAllValidationErrors } from "../ValErrorProvider";
import {
  useAllSourcesWhen,
  useFilePatchIds,
  useSchemas,
  useValConfig,
} from "../ValFieldProvider";
import { useProjectLocales } from "../../hooks/useProjectLocales";
import { useCreatableRouters } from "../useCreateRouteEntry";
import {
  ShellActivityEntry,
  ShellData,
  ShellDeployment,
  ShellMediaGallery,
} from "./types";
import { useValBuildAccess } from "./useValBuildAccess";
import { useThemeSettings } from "../../hooks/useThemeSettings";
import { useDeploymentStaleTick } from "../../hooks/useDeploymentStaleTick";
import {
  toActivity,
  toAdminLinks,
  toWebComponentsUrl,
  toDataModules,
  toDeployments,
  withStudioPublish,
  toExternalPages,
  toShellPages,
  toValidationErrors,
  directoryName,
  countKeys,
  countErrorsIn,
  toMediaFiles,
  toShellLogo,
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
 *
 * ## Nothing here may move with a field write
 *
 * The answer is a prop of the whole shell, so a new one is a render of the
 * whole Studio. It used to be a new one for every field write, twice over
 * (`docs/plans/studio-write-lag.md`): it read the patch ids, the patch sets
 * and every module's source, and all three move when a title is typed. So:
 *
 * - What a write does move -- the count of pending changes and Recent
 *   activity -- is NOT in this answer. {@link useShellLiveData} reads those,
 *   below the shell's frame, beside what shows them.
 * - What a write could move but usually does not is read so that this
 *   component hears about it only when it did: which modules have a draft
 *   (`useModulesWithPatches`), the routers' and galleries' own sources
 *   (`useModuleSources`), and every module's source only where the project
 *   has languages to tell pages apart by.
 */
export function useShellData(): ShellDataState {
  const navMenu = useNavMenuData();
  const config = useValConfig();
  const profile = useCurrentProfile();
  const validationErrors = useAllValidationErrors();
  const { deployments, observedCommitShas } = useDeployments();
  /*
   * A managed project has no host watching a repository, so the Studio is the
   * deployer and a publish is binary. Read here rather than in the shell,
   * because both the deploy feed and Recent activity narrate the same publishes
   * and must not disagree about them.
   */
  const studioIsDeployer = useStudioIsDeployer();
  /*
   * Val Build's web components only where there is a Val Build credential for
   * them to use, and the way they ask an editor to sign in. See
   * `useValBuildAccess`.
   */
  const mode = useValMode();
  const valBuild = useValBuildAccess(mode);
  const profilesByAuthorId = useProfilesByAuthorId();
  /*
   * The external router's own scheme policy.
   *
   * Read here rather than only inside the dialog because the Pages panel's
   * count is computed from the shell's data, and a count that disagrees with
   * the dialog it opens is worse than no count.
   */
  const { externalRouter } = useCreatableRouters();

  const staleTick = useDeploymentStaleTick(deployments);

  // Relative times are computed once per feed change rather than per render,
  // so a row does not silently disagree with the one above it.
  const listedDeployments = useMemo(() => {
    void staleTick;
    return toDeployments(
      deployments,
      observedCommitShas,
      profilesByAuthorId,
      Date.now(),
    );
  }, [deployments, observedCommitShas, profilesByAuthorId, staleTick]);
  const { state: deployState } = useStudioDeployState();
  const shellDeployments = useMemo(
    () => withStudioPublish(listedDeployments, deployState),
    [listedDeployments, deployState],
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
  const recordData = records.status === "success" ? records.data : null;

  /**
   * Every gallery's files, sorted by name: a memo of its own, moved only by
   * the galleries' own source.
   *
   * It was part of the one below, which moves with the patch list and the
   * validation errors -- so every keystroke anywhere listed and sorted every
   * library again, 10,000 files each, and a page that only pointed at three
   * of them froze for a tenth of a second per character.
   */
  const mediaFiles = useMemo(
    () =>
      (recordData?.slice(externalPath ? 1 : 0) ?? []).map((record) => ({
        itemCount: countKeys(record),
        files: toMediaFiles(record),
      })),
    [recordData, externalPath],
  );

  // Which modules have unpublished work: the draft marker for every row in
  // the navigation.
  const modulesWithDrafts = useModulesWithPatches();

  /**
   * The project's own mark, and the patch ids that say where its bytes are.
   *
   * Resolved here rather than in `LeftRail`, so the rail stays presentational
   * and a story can hand it a logo. `useFilePatchIds` is the same map
   * `getMediaFileUrl` uses in `ValShell`, for the same reason: a
   * just-uploaded file is only readable with its patch id.
   */
  const themeSettings = useThemeSettings();
  const filePatchIds = useFilePatchIds();
  /*
   * In a proposal the branch is the proposal's: its changes and saves are on
   * it, never on the site's, and the status bar should not say otherwise.
   */
  const proposalBranch = useCurrentProposal()?.branch ?? null;

  /*
   * Which language each page and each module is in, so the shell can list only
   * the ones the picked language shows. The same `localeAt` question the server
   * asks — a route whose URL names its language answers from the key, content
   * with a locale field from that field. A project that declares no languages
   * reads nothing for it.
   */
  const projectLocales = useProjectLocales();
  const schemas = useSchemas();
  // Every module's source moves with every field write, so it is read only
  // where there are languages for it to answer about.
  const allSources = useAllSourcesWhen(projectLocales.length > 0);
  const locales = useMemo(() => {
    if (projectLocales.length === 0 || schemas.status !== "success") {
      return null;
    }
    const schemaData = schemas.data;
    const schemaByPath = new Map(Object.entries(schemaData));
    const sourceByPath = new Map(Object.entries(allSources));
    return {
      ofPage: (sourcePath: SourcePath): string | null => {
        const [moduleFilePath] =
          Internal.splitModuleFilePathAndModulePath(sourcePath);
        const schema = schemaData[moduleFilePath];
        const source = allSources[moduleFilePath];
        if (schema === undefined || source === undefined) return null;
        return (
          localeScopeAt(sourcePath, schema, source, projectLocales)?.locale ??
          null
        );
      },
      ofModule: (moduleFilePath: string): string | null => {
        const schema = schemaByPath.get(moduleFilePath);
        const source = sourceByPath.get(moduleFilePath);
        if (schema === undefined || source === undefined) return null;
        return localeOfModuleRoot(schema, source, projectLocales);
      },
    };
  }, [projectLocales, schemas, allSources]);

  const state = useMemo((): ShellDataState => {
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
    const externalRecord = externalPath ? recordData?.[0] : undefined;

    return {
      status: "success",
      data: {
        projectName: config?.project ?? "Val",
        logo: toShellLogo(themeSettings.logo, filePatchIds, config?.project),
        admin: toAdminLinks(config),
        webComponentsUrl: valBuild.connected
          ? toWebComponentsUrl(config)
          : undefined,
        studioMode: valBuild.studioMode,
        branch: proposalBranch ?? config?.gitBranch,
        hasRouters: navData?.hasRouters ?? false,
        pages: navData?.sitemap
          ? toShellPages(navData.sitemap, modulesWithDrafts, locales?.ofPage)
          : [],
        // Absent rather than empty when nothing accepts a page, so the shell
        // hides the New page buttons instead of opening a form that can only
        // say no.
        newPage: newPageRoutes,
        externalPages: toExternalPages(externalRecord, validationErrors),
        externalModuleFilePath: externalPath,
        externalSchemes: externalRouter?.schemes,
        externalPagesLoading: externalPath !== undefined && recordData === null,
        media: (navData?.media ?? []).map(
          (entry, index): ShellMediaGallery => ({
            id: entry.moduleFilePath,
            name: directoryName(entry.dir),
            dir: entry.dir,
            moduleFilePath: entry.moduleFilePath,
            mediaType: entry.mediaType,
            ...(entry.fonts ? { fonts: true } : {}),
            itemCount: mediaFiles[index]?.itemCount ?? 0,
            files: mediaFiles[index]?.files,
          }),
        ),
        settings: navData?.settings
          ? {
              moduleFilePath: navData.settings.moduleFilePath,
              errorCount: countErrorsIn(
                validationErrors,
                navData.settings.moduleFilePath,
              ),
              hasDraft: modulesWithDrafts.has(navData.settings.moduleFilePath),
            }
          : undefined,
        data: navData?.explorer
          ? toDataModules(
              navData.explorer,
              modulesWithDrafts,
              locales?.ofModule,
            )
          : [],
        validationErrors: toValidationErrors(validationErrors),
        // `activity` and `pendingChanges` move with every field write: see
        // `useShellLiveData`.
        deployments: shellDeployments,
        studioIsDeployer,
        user: profile
          ? {
              name: profile.fullName,
              email: profile.email,
              ...(profile.avatar?.url ? { avatarUrl: profile.avatar.url } : {}),
            }
          : undefined,
      },
    };
  }, [
    themeSettings,
    filePatchIds,
    navMenu,
    navData,
    recordData,
    mediaFiles,
    externalPath,
    externalRouter,
    config,
    profile,
    validationErrors,
    modulesWithDrafts,
    shellDeployments,
    studioIsDeployer,
    valBuild.connected,
    valBuild.studioMode,
    mode,
    proposalBranch,
    locales,
  ]);
  /*
   * The answer before, while this one says the same all the way down. What
   * it is built from can move without moving it: the page being typed in is
   * an entry of a router whose keys are the nav, so the router's source is a
   * new object for every write and the nav built from it comes out as it
   * was. Compared rather than trusted to its inputs, because a new answer
   * here is a render of the whole Studio. Parts that did not move are the
   * same objects (the media lists above all), so the comparison stops at
   * them.
   */
  return useKept(state, sameDeep);
}

/** The parts of {@link ShellData} a field write moves. */
export type ShellLiveData = {
  /** See `ShellData.pendingChanges`. */
  pendingChanges: number;
  /** See `ShellData.activity`. */
  activity: ShellActivityEntry[];
};

/**
 * What a field write moves in the shell's data: how many changes are pending,
 * and Recent activity.
 *
 * Apart from {@link useShellData} so that the component that calls this is
 * the one that renders for a write, and it is a small one below the shell's
 * frame (`ValShellLive`), not the Studio. Takes the publishes from the
 * shell's own data, so the two lists that narrate them cannot disagree.
 */
export function useShellLiveData(
  deployments: ShellDeployment[] | undefined,
  studioIsDeployer: boolean | undefined,
): ShellLiveData {
  const patchSets = usePatchSets();
  const pendingChanges = usePendingChangeCount();
  /*
   * The publishes ride along: this list is "what has been happening", and a
   * publish is the other half of that. See `toActivity`.
   *
   * Built from whatever is known, rather than only once the PATCH SETS are.
   * The two halves load separately - patch sets come off a worker that has
   * to group them, publishes off the stat feed - so gating the whole list on
   * the first one hid every publish while that worker was still grouping,
   * and for good if it failed. An empty change list is the honest input in
   * that state, not a reason to say nothing.
   */
  const activity = useMemo(
    () =>
      toActivity(
        patchSets.status === "success" ? patchSets.data : [],
        deployments ?? [],
        Date.now(),
        studioIsDeployer ?? false,
      ),
    [patchSets, deployments, studioIsDeployer],
  );
  return useMemo(
    () => ({ pendingChanges, activity }),
    [pendingChanges, activity],
  );
}
