/*
 * The builder a deploy runs on: `@valbuild/tanstack-build`'s browser entry,
 * as whoever embeds the deploy loads it -- the Studio in a worker
 * (`loadBuilder.ts` in `@valbuild/ui`), home's upgrade page in its own. A type
 * only: this package never imports the builder, so nothing here pulls 11 MB
 * of WebAssembly into a bundle that did not ask for it.
 */
import type * as TanstackBuild from "@valbuild/tanstack-build";

type Builder = typeof TanstackBuild;

/**
 * What the Studio uses out of the builder package: five methods, each of which
 * may answer later.
 *
 * Later because the builder runs in a worker (`importBuilder` in `@valbuild/ui`'s `loadBuilder.ts`), so
 * even `bakedGit` -- synchronous in the package -- is a round trip here. The
 * package module itself still satisfies this type, which is what lets a test
 * hand one in.
 */
export type StudioBuilder = {
  bakedGit: (
    ...args: Parameters<Builder["bakedGit"]>
  ) =>
    | ReturnType<Builder["bakedGit"]>
    | Promise<ReturnType<Builder["bakedGit"]>>;
  rebakeGit: (
    ...args: Parameters<Builder["rebakeGit"]>
  ) =>
    | ReturnType<Builder["rebakeGit"]>
    | Promise<ReturnType<Builder["rebakeGit"]>>;
  buildUserApp: Builder["buildUserApp"];
  publishArtifacts: Builder["publishArtifacts"];
  /** A build's name, before building it: see `buildInputId`. */
  buildInputId: Builder["buildInputId"];
  /** A tree's Val modules, as one module to evaluate: see `bundleValModules`. */
  bundleValModules: Builder["bundleValModules"];
};
