/**
 * Turning an imported checkout into something the platform can serve.
 *
 * A repository is written for `vite dev` and a filesystem. This platform has
 * neither: the app runs in a Worker isolate with no disk, its source arrives as
 * a module, and a save cannot republish itself because there is no bundler in
 * there. Wiring that up is the HOST's job -- a project should not have to know
 * which platform is going to serve it -- and until now it was done by
 * `scripts/val-playground.ts`, a Node script, which is why `Load` produced a
 * record that built and then could not be edited.
 *
 * What this deliberately does NOT do is the rest of what that script does. It
 * patches `node_modules`, pins a Val project for remote images, deletes the
 * template's product routes and renders the page description so an edit is
 * visible. Those are demo scaffolding and environment fixes, not wiring, and a
 * host that did them to someone's repository would be vandalising it.
 */
import { TREE } from "./projectPaths";

export interface Change {
  what: string;
  why: string;
}

export interface WireResult {
  files: Record<string, string>;
  changes: Array<Change>;
  /** Things that will bite later, reported rather than fixed. */
  warnings: Array<string>;
}

export interface WireOptions {
  /** The project id the app puts its pending source under, as a fallback. */
  project: string;
  /**
   * The platform's control plane.
   *
   * No longer baked into the generated file -- a save posts to the sentinel
   * host the platform intercepts, because an isolate cannot fetch the loader's
   * real address. Kept because a caller still identifies the platform it is
   * wiring for, and the next thing that needs it will want it here.
   */
  loader: string;
  /**
   * The commit this source was read at, and the branch a publish commits to.
   *
   * Load bearing rather than bookkeeping. Val reads a project's content from
   * the content service AT A COMMIT, so a build wired with the wrong one edits
   * and renders a different version of its files than the code it is running.
   *
   * Absent for a source that came from no commit at all -- a record assembled
   * in a tab, a fixture. Such a build serves its pages and cannot edit, which
   * the generated file decides in one place rather than failing five ways.
   */
  git?: { commit: string; branch: string };
}

/**
 * Where a Val project keeps the module this replaces.
 *
 * Exported because a caller has to be able to rewrite JUST this file. The
 * commit is baked into it (see `BUILT_FROM` in the template), and the files a publish
 * hands over are the `.val.ts` ones it patched -- this is never among them, so a tab
 * that merged a save and rebuilt would compile the NEW content against the OLD
 * commit and read the wrong version of it back.
 */
export const VAL_SERVER_PATH = "src/val/val.server.ts";
const VAL_SERVER = VAL_SERVER_PATH;
const PROJECT_SOURCE_TYPES = "src/val/project-source.d.ts";

/**
 * The sentinel host a wired app reaches its platform at.
 *
 * Spelled out here rather than imported from the loader: this package is built
 * into a browser bundle and the loader's into a Worker. One name in two
 * spellings is the risk, which is why this is a constant used by both the
 * template it goes into and the check that reads it back out.
 */
const CONTROL_HOST = "platform.internal";

/**
 * The editing backend, as this platform needs it.
 *
 * **This is http mode, and almost nothing here deviates from it.** A published
 * app reads its content from Val's content service at a commit, relays patches
 * there, and hands the browser a presigned URL to upload an image to -- exactly
 * as a Val app deployed anywhere else does. Worth stating because this file used
 * to do none of it: it put Val in `memory` mode, which sets `patchesAreLocal`,
 * and that one flag moved pending patches into a store of the platform's own and
 * buffered every draft image through the isolate. Two behaviours nobody chose,
 * out of one word.
 *
 * Two things differ, and each is load bearing:
 *
 * - **`publishOverride`** is the seam, and the only place this platform is
 *   unlike any other host. A publish here commits -- the default, handed over as
 *   `commitToGit` -- AND puts the files it committed where the platform can
 *   reach them, because there is no bundler in the isolate: the studio tab picks
 *   them up, builds, and the result
 *   is served immediately instead of a host noticing the commit and redeploying.
 * - **no formatter.** A repository passes prettier here so a patch written to
 *   disk comes out formatted like the rest of the code. Prettier's bundle
 *   TDZ-crashes in a Worker isolate ("Cannot access 'y' before
 *   initialization"), and nothing is being written to disk anyway.
 *
 * WHAT IT COSTS, said here because the code cannot show it: a project with no
 * `VAL_API_KEY` and `VAL_SECRET` cannot serve its content at all, where a
 * memory-mode build could -- its sources were compiled into the bundle, and
 * these are fetched. Credentials stop being what EDITING needs and become what
 * running needs.
 */
const valServerSource = ({ project, git }: WireOptions) => `import {
  initValContent,
  initValServer,
  type ValHttpMode,
} from "@valbuild/tanstack/server";
import { config } from "../../val.config";
import valModules from "../../val.modules";

/**
 * A secret, as the platform hands it over at RUNTIME.
 *
 * Preferred over \`process.env\`, which the builder inlines as a literal into
 * this bundle: that puts the value in storage inside the code, copies it into
 * every isolate that loads it, and makes rotating it a republish.
 *
 * Falls back to the build-time value, so an app published before secrets
 * existed keeps working.
 */
function secret(name: string): string | undefined {
  return (globalThis.__PLATFORM_SECRETS ?? {})[name] ?? process.env[name];
}

/**
 * Hand the files a publish committed back to the platform, to be built.
 *
 * There is no bundler in the isolate, so the commit a publish just made cannot
 * become a running site on its own. This writes what the commit contained, with
 * the commit's own sha, to the platform's pending source, and the studio tab
 * picks that up and builds. The sha is not a receipt: it is what the next build
 * is wired AT, so handing over the wrong one produces a build that reads a
 * different version of its content than it was compiled from.
 *
 * Named for \`putPendingSource\` in the loader's storage, which is what the
 * other side of this request calls -- along with \`getPendingSource\` and
 * \`clearPendingSource\`, which the studio tab uses to pick it up and let it go.
 * One mechanism, one noun, however many processes it crosses.
 */
async function putPendingSource(
  patchedSourceFiles: Record<string, string | null>,
  commitSha?: string,
  /**
   * What the commit was built ON, and what it points AT.
   *
   * Both optional, and absent is meaningful rather than lazy: a Val too old to
   * report them sends neither, and the platform has to be able to tell that
   * apart from a commit that genuinely has no parent. It falls back to treating
   * the hand-over as unchained -- correct but conservative -- rather than
   * assuming it is a root commit and concluding the history starts here.
   */
  parentSha?: string,
  treeSha?: string,
) {
  try {
    /*
     * A name the PLATFORM serves, not a URL on the internet.
     *
     * This used to post to the loader's public address, which works in dev --
     * a different port on loopback -- and cannot work deployed: a Worker may
     * not fetch the hostname it is itself served on, so Cloudflare resolved
     * the subrequest away and answered 404. A save then failed with Val's
     * \`HTTPError\` and the real cause only in the isolate's log.
     *
     * The platform intercepts this host and answers it from inside, so the
     * door is one it holds rather than one this file knows the address of.
     * \`.internal\` resolves nowhere, so if interception ever stopped, this
     * fails closed instead of reaching a stranger.
     */
    const res = await fetch("https://${CONTROL_HOST}/__api/source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        /*
         * The project this isolate is actually SERVING, not the one it was
         * generated for.
         *
         * The platform sets __PLATFORM_PROJECT_ID per request from the id the loader
         * resolved off the hostname. The literal is only a fallback, for a build
         * served by a platform too old to set it -- and it is a bad one: publish
         * the same bundle to two projects and every edit made on either lands
         * under whichever name was baked in here.
         */
        project: projectId(),
        files: patchedSourceFiles,
        commitSha,
        /*
         * Spread, so a Val that did not report them leaves the keys out of the
         * body entirely. \`parentSha: undefined\` would serialise to nothing
         * anyway, but the platform reads this body with a schema, and an
         * explicitly-absent key is what lets it distinguish "this build's Val
         * cannot tell me" from "there is no parent".
         */
        ...(parentSha !== undefined ? { parentSha } : {}),
        ...(treeSha !== undefined ? { treeSha } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(\`source endpoint returned \${res.status}\`);
    }
  } catch (error) {
    throw new Error(\`PENDING_SOURCE_FAILED: \${String(error)}\`);
  }
}

/** The project this isolate is serving. See the note in \`putPendingSource\`. */
function projectId() {
  return globalThis.__PLATFORM_PROJECT_ID ?? ${JSON.stringify(project)};
}

/**
 * The commit this build was made from, and the branch it commits to.
 *
 * Baked in rather than handed over at runtime, unlike a secret, because it is
 * not configuration -- it is a property OF THIS BUILD. Every read of a
 * \`.val.ts\` in http mode fetches that path from the content service at this
 * sha, so a build served with somebody else's commit renders and edits a
 * version of its files it was not compiled from. A secret can be rotated under
 * a running build; this cannot, and publishing again is how it changes.
 *
 * WHAT THIS IS NOT. It is not every read: a committed render reads the source
 * bundled into this build and asks the content service nothing. It is the
 * PUBLISH path -- turning pending patches into new \`.val.ts\` text means
 * fetching the current text to patch, and that is the read that happens at
 * this sha. The docblock used to say "every read", which sent readers looking
 * for a content call on the serving path that is not there.
 *
 * \`null\` when the source came from no commit -- a record assembled in a tab,
 * a fixture, or ANY build this platform makes, which is the common case rather
 * than the exception. Such a build has no repository to mirror commits into,
 * and does not need one: the content service is the store of record for
 * content and mints its own commit shas. Val is in http mode on credentials
 * alone.
 */
const BUILT_FROM = ${git ? JSON.stringify(git) : "null"};

/**
 * What puts Val in http mode: its content service owns the content.
 *
 * The same three things any deployed Val app is configured with. Note what is
 * NOT here: no \`sourceFiles\`, so patches are relayed to the content service
 * instead of being kept by this platform, and the browser uploads an image
 * straight there on a presigned URL instead of streaming it through here.
 *
 * \`undefined\` when a credential or the commit is missing, and deliberately not
 * a throw at module scope: that would take the isolate down with it, page
 * renders included. Val is left to refuse the request and name what it wanted
 * -- \`VAL_ENV=app\` is set on this build precisely so that a missing credential
 * is an error instead of a fall-through to \`fs\` mode, looking for a working
 * tree that is not in here.
 */
const apiKey = secret("VAL_API_KEY");
const valSecret = secret("VAL_SECRET");
/*
 * Which content service, for a project that is not pointed at the real one.
 *
 * A secret rather than a baked literal, because unlike the commit this IS
 * configuration: the same build should be servable against a stand-in and
 * against production. It is what makes the editing path testable at all --
 * Val's own \`e2e/mock-content-host\` implements this wire protocol with no git
 * repository behind it -- and without it a build could only ever talk to
 * content.val.build.
 *
 * It does NOT redirect everything, and the gap is in Val rather than here:
 * \`getSettings\`, which remote FILES use, reads \`process.env.VAL_CONTENT_URL\`
 * at module scope inside @valbuild/server. This platform bundles its
 * dependencies separately from the app, so nothing it sets reaches that read --
 * the same reason \`apiKey\` has to be passed in rather than found. So patches,
 * commits and source reads go where this says, and remote file uploads still
 * address the real host.
 */
const valContentUrl = secret("VAL_CONTENT_URL");
/*
 * WHICH project's content this is, at the content service.
 *
 * Val's own name for the project (\`org/name\`), which is not the platform's
 * project id and cannot be derived from it. A repository that is deployed
 * anywhere else puts it in \`val.config.ts\`; one imported here need not have,
 * so it is configuration the platform can supply -- and it goes through
 * \`secret\` rather than \`--env\` for a second reason: a build-time literal
 * would have to be baked into the shared dependency layer, where
 * @valbuild/server reads \`process.env.VAL_PROJECT\`, and that layer is reused
 * by every project with the same dependencies.
 *
 * What the app configured wins over nothing at all, so a repository that does
 * name its project keeps working with no secret set.
 */
const valProject = secret("VAL_PROJECT");
const valConfig = {
  ...config,
  ...(valProject !== undefined ? { project: valProject } : {}),
};
/*
 * CREDENTIALS ALONE. A commit is not part of what puts Val in http mode.
 *
 * It used to be: \`GIT !== null\` was in this condition, and a build with no
 * commit fell through to \`undefined\` -- which meant every site this platform
 * seeded was silently unable to edit, because a shared build cannot know a
 * commit. The binding that worked around it (\`VAL_GIT_COMMIT\` /
 * \`VAL_GIT_BRANCH\` out of the project's secrets) is gone with it: it named a
 * commit in the TEMPLATE's repository, which was true only for as long as
 * seeding and repository creation shared a template, and it was one more thing
 * in KV that could go stale.
 *
 * \`git\` is now optional and absent here for every build this platform makes.
 * The content service owns the commit chain and mints its own shas, so there
 * is nothing to bake and nothing to bind -- and one source per environment
 * means no precedence rule between a baked value and a bound one.
 */
const http =
  apiKey !== undefined && valSecret !== undefined
    ? {
        apiKey,
        valSecret,
        /*
         * FLAT, and \`satisfies\` on this inner object rather than on \`http\`.
         *
         * This read \`{ git: BUILT_FROM }\` until the wiring moved into the Val
         * repository, and had done since \`ValHttpMode\` was flattened to
         * \`gitCommit\`/\`gitBranch\`. An unknown key is ignored, so a build
         * wired FROM A COMMIT ran as though it had none: content read and
         * written at the branch head instead of at the commit the running code
         * was built from, silently, which is the exact failure the commit is
         * carried to prevent.
         *
         * The guard has to sit HERE because a conditional spread defeats every
         * other form of it -- an annotation on \`http\`, a \`satisfies\` on
         * \`http\`, and passing it to a typed parameter all accept an extra key
         * that arrives by spread. Only a fresh object literal checked against a
         * type gets excess-property checking, so the literal is checked where
         * it is written.
         */
        ...(BUILT_FROM !== null
          ? ({
              gitCommit: BUILT_FROM.commit,
              gitBranch: BUILT_FROM.branch,
            } satisfies Pick<ValHttpMode, "gitCommit" | "gitBranch">)
          : {}),
        ...(valContentUrl !== undefined ? { valContentUrl } : {}),
      }
    : undefined;

const { valApiHandler, draftMode } = initValServer(
  valModules,
  valConfig,
  {
    ...(http ? { http } : {}),
    /*
     * The one thing this platform does differently from any other Val host.
     *
     * A publish in http mode is a git commit, and that stays: \`commitToGit\` is
     * the default, handed over rather than skipped, and calling it is what makes
     * the content service mark the patches published and the repository carry
     * the change. What is ADDED is the build -- the tab picks the pending
     * source up, compiles it, and the result is served immediately, rather than
     * a host noticing the commit and redeploying minutes later.
     *
     * ORDER: commit, then hand over. The commit is the source of truth, and
     * writing the pending source first would mean a build whose content the
     * content service does not have yet, so every read in it would resolve the
     * previous commit -- the site showing pre-save content with the edits
     * already consumed.
     *
     * A hand-over that fails after a commit that succeeded is NOT reported as a
     * failed publish, which is deliberate: the commit happened, and saying it
     * did not is the more misleading of the two. What is lost is the immediate
     * rebuild, so the site serves its previous build until the next publish --
     * recoverable, and the tab can reload the repository at the new commit to
     * do it.
     */
    publishOverride: async ({ patchedSourceFiles, commitToGit }) => {
      const committed = await commitToGit();
      if (committed.error) {
        return committed;
      }
      try {
        await putPendingSource(
          patchedSourceFiles,
          committed.commit,
          /*
           * Added by @valbuild/server after 0.132.0. An older one has neither
           * field and the platform is told nothing rather than told wrongly --
           * see the note on the parameters.
           */
          committed.parent,
          committed.tree,
        );
      } catch (error) {
        console.error(
          "Val: the commit landed, but the platform could not be given the " +
            "files to build. The site serves its previous build until it is " +
            "published again.",
          error,
        );
      }
      return committed;
    },
  },
);

const {
  fetchValStega: fetchVal,
  fetchValKeyStega: fetchValKey,
  fetchValRouteStega: fetchValRoute,
  fetchValRouteUrl,
} = initValContent(valConfig, valModules, {
  draftMode,
  /*
   * The SAME object the API got.
   *
   * These readers resolve content through a Val server of their own rather than
   * by calling the API over HTTP, so the mode question is put to them
   * separately -- configuring only \`initValServer\` left them inferring \`fs\`
   * mode, looking for a working tree that is not in here. \`gitCommit\` is the
   * field that would be silently wrong rather than loudly missing: two
   * different shas means the API edits one version of a file while the page
   * renders another.
   */
  ...(http ? { http } : {}),
});

/**
 * A build that is MEANT to edit and cannot, refusing instead of pretending to.
 *
 * \`BUILT_FROM\` being non-null says this build came from a commit, so it was
 * made to edit against a content service. If the credentials for that service are not
 * here, the configuration is broken -- and the failure that was reaching people
 * was not an error at all. Val picks its storage mode by inference, so an
 * isolate with no api key lands in a mode that ACCEPTS the write and keeps it
 * in the isolate. Cloudflare starts an isolate per concurrent request, so the
 * save answers 200 and the next request, served by a different isolate, has
 * never heard of it. The edit is simply gone, and nothing anywhere said so.
 *
 * That is the worst available outcome: a person is told their work is saved
 * when it is not. Refusing is strictly better, and naming the missing secret
 * turns an evening of reading logs into one line in a response body.
 *
 * WHY HERE rather than relying on \`VAL_ENV=app\`: that is a build-time
 * substitution into the shared dependency layer, so whether a build fails
 * loudly depends on which layer it happens to be pinned to. This file is
 * written on every build, by the platform, and cannot be missing from one.
 *
 * Only the editing API. Page renders do not come through here, and a site whose
 * content cannot be edited should still serve the content it has.
 */
const editingApiHandler =
  http === undefined
    ? async () => {
        const missing = [
          apiKey === undefined ? "VAL_API_KEY" : null,
          valSecret === undefined ? "VAL_SECRET" : null,
          /*
           * A build from no commit is listed the same way, because from the
           * outside the two are one state. It is not a secret somebody can set
           * -- a commit is a property OF THE BUILD, and the only cure is
           * publishing this project's own repository over whatever is serving
           * it. Named anyway, because "it was built from no commit" is the
           * sentence that ends the search.
           */
          BUILT_FROM === null ? "a commit (this build was made from none)" : null,
        ].filter(Boolean);
        return Response.json(
          {
            error:
              "This site cannot be edited. Its content lives in a content service, and " +
              missing.join(", ") +
              " " +
              (missing.length > 1 ? "are" : "is") +
              " missing, so there is nothing to edit against. Editing is refused rather " +
              "than kept in this isolate's memory, where it would be lost without being " +
              "reported." +
              (BUILT_FROM === null
                ? " A build made from no commit is usually one SEEDED from a template: " +
                  "publish this project's own repository to replace it."
                : " This build was made from commit " + BUILT_FROM.commit.slice(0, 8) + "."),
            missing,
          },
          { status: 503 },
        );
      }
    : valApiHandler;

export {
  editingApiHandler as valApiHandler,
  draftMode,
  fetchVal,
  fetchValKey,
  fetchValRoute,
  fetchValRouteUrl,
};
`;

/**
 * Types for what the PLATFORM supplies, which is in no package.
 *
 * Declared rather than suppressed: an editor open on this project should know
 * what `FILES` is, and the alternative is a file full of red squiggles that a
 * developer learns to ignore.
 */
const PROJECT_SOURCE_DECLARATIONS = `// Generated by the Val studio when this project was wired up to the platform.
// The build resolves this specifier to the project's own source, shipped into
// the isolate as a module.
declare module 'platform:project-source' {
  /** Every source file of this project, keyed by its path from the root. */
  export const FILES: Record<string, string>
}

declare global {
  /**
   * The project this isolate is serving, set per request by the platform from
   * the id the loader resolved off the hostname.
   *
   * Absent when server-rendering outside the platform, and in the browser.
   */
  // eslint-disable-next-line no-var
  var __PLATFORM_PROJECT_ID: string | undefined
  /**
   * This project's secrets, handed over per request rather than built in.
   *
   * SERVER ONLY -- set by the platform's Worker entry, which never runs in a
   * browser. Absent outside the platform.
   */
  // eslint-disable-next-line no-var
  var __PLATFORM_SECRETS: Record<string, string> | undefined
}
export {}
`;

/**
 * The wired `val.server.ts`, on its own.
 *
 * {@link wireUp} does this and eight other things, which is right when a
 * repository arrives and wrong every time a build is about to run: re-deriving
 * a package.json and a route entry to change one baked-in sha would be a lot of
 * machinery to get a one-line difference, and any of it not being idempotent
 * would be a bug that only shows up on the second publish.
 */
export function wiredValServer(options: WireOptions): string {
  return valServerSource(options);
}

/**
 * The commit a wired record was last built at, read back out of the file.
 *
 * The inverse of `BUILT_FROM` in the template, and it lives here so that one place
 * knows the format -- a reader elsewhere would go stale the first time the
 * template's shape changed, and silently, since a failed parse and a build
 * with no commit look identical.
 *
 * There is nowhere else this could come from. A record adopted from the live
 * build IS the published source, and the commit it was published at is a
 * literal inside its own `val.server.ts`.
 */
export function bakedGit(
  files: Record<string, string>,
): { commit: string; branch: string } | undefined {
  const source = files[VAL_SERVER];
  if (source === undefined) return undefined;
  /*
   * `BUILT_FROM`, which is the literal, and now the only place a commit can
   * come from at all.
   *
   * There used to be a `GIT` expression beside it that fell back to a runtime
   * binding for a SHARED build, which a reader of files alone could not
   * evaluate. That has gone: the content service owns the commit chain, so a
   * platform build bakes nothing and binds nothing, and this returns
   * `undefined` for one -- which is the truth about it.
   */
  const match = /^const BUILT_FROM = (.+);$/m.exec(source);
  if (!match?.[1] || match[1] === "null") return undefined;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { commit, branch } = parsed as Record<string, unknown>;
    if (typeof commit !== "string" || typeof branch !== "string")
      return undefined;
    if (commit === "" || branch === "") return undefined;
    return { commit, branch };
  } catch {
    return undefined;
  }
}

/** Is this a Val project at all? */
export function isValProject(files: Record<string, string>): boolean {
  return "val.config.ts" in files && "val.modules.ts" in files;
}

/**
 * Has this record already been wired up?
 *
 * The control host is the marker. It used to be `platform:project-source`,
 * which the generated file imported while Val was in memory mode and no longer
 * does -- the project's source stopped being shipped into the isolate when the
 * content service became what answers for it. The pending-source POST is the
 * thing that cannot be anything but this platform's: no repository posts to a
 * host that resolves
 * nowhere, and every wired file has to, because an isolate cannot build.
 */
export function isWired(files: Record<string, string>): boolean {
  return files[VAL_SERVER]?.includes(CONTROL_HOST) ?? false;
}

/**
 * Returns the record with the platform's wiring applied, and what it changed.
 *
 * Non-destructive, and that matters more than it looks: the caller's record is
 * what an edit is applied to, and the source that gets published back.
 */
export function wireUp(
  files: Record<string, string>,
  options: WireOptions,
): WireResult {
  const out = { ...files };
  const changes: Array<Change> = [];
  const warnings: Array<string> = [];

  if (!isValProject(files)) {
    warnings.push(
      "No val.config.ts or val.modules.ts: this does not look like a Val project, so nothing " +
        "was wired up. It may still build and serve.",
    );
    return { files: out, changes, warnings };
  }

  // --- the editing backend ----------------------------------------------------

  out[VAL_SERVER] = valServerSource(options);
  changes.push({
    what: `${VAL_SERVER} rewritten for the platform`,
    why:
      "Val reads its content over HTTP at this commit, as in any deployment, and a publish " +
      "also hands the files it committed to the platform so the tab can build them -- nothing " +
      "else turns a commit into a running site, because there is no bundler in the isolate",
  });

  out[PROJECT_SOURCE_TYPES] = PROJECT_SOURCE_DECLARATIONS;
  changes.push({
    what: `${PROJECT_SOURCE_TYPES} added`,
    why:
      "the platform sets globals for the project id and its secrets, and the build can " +
      "supply `platform:project-source`; no package declares either",
  });

  // --- the Studio's own bundle ------------------------------------------------

  /*
   * `@valbuild/ui` carries the Studio's UI -- 7.15 MB, base64-embedded into the
   * package, served by `/api/val/static/...`. A template usually has it only as
   * a TRANSITIVE dependency, and the vendor layer is built from what a project
   * DECLARES intersected with what it imports. Undeclared, the Studio loads its
   * shell and then 404s on its own bundle.
   */
  const manifestRaw = files["package.json"];
  if (manifestRaw) {
    try {
      const manifest = JSON.parse(manifestRaw) as {
        dependencies?: Record<string, string>;
      };
      const deps = manifest.dependencies ?? {};
      if (deps["@valbuild/core"] && !deps["@valbuild/ui"]) {
        deps["@valbuild/ui"] = deps["@valbuild/core"];
        manifest.dependencies = deps;
        out["package.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
        changes.push({
          what: "@valbuild/ui declared as a dependency",
          why:
            "it carries the Studio bundle and was only a transitive dependency; the vendor " +
            "layer is built from what the project declares",
        });
      }
    } catch {
      warnings.push(
        "package.json could not be parsed, so @valbuild/ui was not declared.",
      );
    }
  }

  // --- generated output the repository happens to track -----------------------

  /*
   * `routeTree.gen.ts` is derived, and this platform generates it per build.
   * Most projects gitignore it; `valbuild/template-tanstack-starter` tracks it,
   * so an import carries a stale copy -- which the build would overwrite and
   * then publish BACK as project source, so the record would slowly fill with
   * generated files that are never read.
   */
  if (TREE in out) {
    delete out[TREE];
    changes.push({
      what: `${TREE} dropped`,
      why: "it is generated per build; a tracked copy would be published back as project source",
    });
  }

  // --- what wiring cannot fix -------------------------------------------------

  warnings.push(
    "This wires the SOURCE up. The project still needs a dependency layer built for it, which " +
      "is a pass over node_modules and cannot happen in a browser.",
  );

  return { files: out, changes, warnings };
}
