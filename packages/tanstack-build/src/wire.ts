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
  /**
   * The project id this record is wired for.
   *
   * No longer written into the generated file: it named the project a save's
   * files were handed over under, and that hand-over is gone. Kept so a caller
   * that identifies the project does not have to change with it.
   */
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
 * commit is baked into it (see `BUILT_FROM` in the template), and the files a save
 * writes are the `.val.ts` ones it patched -- this is never among them, so a tab
 * that laid a save over the project and rebuilt would compile the NEW content
 * against the OLD commit and read the wrong version of it back. `rebakeGit` is
 * what the Studio calls.
 */
export const VAL_SERVER_PATH = "src/val/val.server.ts";
const VAL_SERVER = VAL_SERVER_PATH;
const PROJECT_SOURCE_TYPES = "src/val/project-source.d.ts";

/**
 * The first line of every `val.server.ts` this file generates, and how
 * {@link isWired} recognises one.
 *
 * A comment rather than anything the file DOES, because a wired file no longer
 * does anything no other Val host does: it used to post the files a save
 * committed to `platform.internal`, for a builder tab to pick up, and that
 * sentinel host was the marker. A managed project's Studio builds in its own
 * tab now, the loader refuses that door, and the post went with it.
 */
const WIRED_MARKER =
  "// Wired for the Val platform by @valbuild/tanstack-build. Regenerated on publish.";

/**
 * The sentinel host a file wired BEFORE {@link WIRED_MARKER} existed posted to.
 * Still recognised by {@link isWired}, so a project published by an older
 * publisher is not wired twice.
 */
const LEGACY_CONTROL_HOST = "platform.internal";

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
 * One thing differs, and it is load bearing:
 *
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
const valServerSource = ({ git }: WireOptions) => `${WIRED_MARKER}
import {
  initValContent,
  initValServer,
} from "@valbuild/tanstack/server";
import { config } from "../../val.config";
import valModules from "../../val.modules";
/*
 * This build's own source, which a publish patches. A project with no
 * repository has no other copy of its \`.val.ts\` text: content keeps its
 * content as data. Ignored by a @valbuild/tanstack that predates it.
 */
import { FILES } from "platform:project-source";

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
 * The commit is optional NOW, and it is still sent where there is one -- see
 * the note at the spread below. What is gone is the binding that supplied one
 * from KV, so there is one source per environment and no precedence rule
 * between a baked value and a bound one.
 */
const http =
  apiKey !== undefined && valSecret !== undefined
    ? {
        apiKey,
        valSecret,
        /*
         * BOTH SPELLINGS OF THE COMMIT, because the APP decides which one is
         * read and this file cannot know which app it is being written into.
         *
         * \`ValHttpMode\` has been renamed in both directions. Up to 0.132 it
         * took \`gitCommit\`/\`gitBranch\`; 0.133.0 replaced that pair with a
         * nested \`git\`; the version this package ships beside flattens it
         * back again. The generated file is compiled against whatever
         * \`@valbuild/tanstack\` the PROJECT installed -- the starter pins
         * 0.133.0 -- and a platform writing this file has no say in that. So
         * this is not one rename behind or ahead: it is on both sides of one at
         * once, and will be until every app it publishes has moved.
         *
         * Sending only the wrong one is SILENT, which is why this is belt and
         * braces rather than a version check. An unknown key on the options
         * object is ignored, so the commit is simply dropped and a build wired
         * FROM A COMMIT runs as though it had none -- which means a publish
         * produces no mirrored \`.val.ts\`, so a save commits and hands over
         * nothing, and the site keeps serving its old content with the patches
         * already consumed. Nothing reports it. valbuild/home's loop is the one
         * thing that sees it, and it was bisected there: 25/25 with the key the
         * installed version reads, 21/23 without, failing at exactly "the save
         * left the file it rewrote pending".
         *
         * Whichever version is installed reads its own key and ignores the
         * other two. Drop this to one spelling when every app this platform
         * publishes is past the rename -- not before, and not on the say-so of
         * a compiler in the Val repository, which is looking at a different
         * version of \`@valbuild/tanstack\` than the app is.
         */
        ...(BUILT_FROM !== null
          ? {
              git: BUILT_FROM,
              gitCommit: BUILT_FROM.commit,
              gitBranch: BUILT_FROM.branch,
            }
          : {}),
        ...(valContentUrl !== undefined ? { valContentUrl } : {}),
        projectSource: FILES,
      }
    : undefined;

const { valApiHandler, draftMode } = initValServer(
  valModules,
  valConfig,
  {
    ...(http ? { http } : {}),
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
/**
 * The one line that carries the commit.
 *
 * Shared by the reader below and the rewriter under it, so the two cannot
 * disagree about the format -- which they would silently, since a failed parse
 * and a build made from no commit are the same answer.
 */
const BUILT_FROM_LINE = /^const BUILT_FROM = (.+);$/m;

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
  const match = BUILT_FROM_LINE.exec(source);
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

/**
 * The same record, wired at a different commit.
 *
 * The inverse of {@link bakedGit}, and the whole of what a rebuild has to
 * change: `BUILT_FROM` is the only place the commit appears, and every other
 * use in the generated file reads it.
 *
 * REWRITES one line rather than regenerating the file, and that is the point.
 * `wiredValServer` needs the project id and the platform's address, which the
 * publisher that has them is the tab; a Studio publishing from inside the
 * deployment has neither, and reconstructing the file from what it could guess
 * would throw away wiring it cannot see. Replacing the literal cannot.
 *
 * Returns the record unchanged when there is nothing to rewrite -- no
 * `val.server.ts`, or one this does not recognise. Unchanged rather than
 * thrown, because the caller's next step is a build, and a build of a record
 * with no wired server is a project that was never wired: a real thing, which
 * fails with its own message rather than this one.
 *
 * Non-destructive, like {@link wireUp}: the caller's record is what gets
 * published back as source.
 */
export function rebakeGit(
  files: Record<string, string>,
  git: { commit: string; branch: string } | null,
): Record<string, string> {
  const source = files[VAL_SERVER];
  if (source === undefined) return files;
  if (!BUILT_FROM_LINE.test(source)) return files;
  return {
    ...files,
    [VAL_SERVER]: source.replace(
      BUILT_FROM_LINE,
      `const BUILT_FROM = ${git === null ? "null" : JSON.stringify(git)};`,
    ),
  };
}

/** Is this a Val project at all? */
export function isValProject(files: Record<string, string>): boolean {
  return "val.config.ts" in files && "val.modules.ts" in files;
}

/**
 * Has this record already been wired up?
 *
 * {@link WIRED_MARKER} is the marker, or -- for a file generated before it
 * existed -- the sentinel host that file posted its saves to. It used to be
 * `platform:project-source` before that, which the generated file imported
 * while Val was in memory mode.
 */
export function isWired(files: Record<string, string>): boolean {
  const source = files[VAL_SERVER];
  if (source === undefined) return false;
  return (
    source.startsWith(WIRED_MARKER) || source.includes(LEGACY_CONTROL_HOST)
  );
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
