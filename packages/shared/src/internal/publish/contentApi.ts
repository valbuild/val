/**
 * The publish API's types, COPIED from the service that serves them.
 *
 * Source: `content/src/handlers/Api.ts` in valbuild/home. The routes below
 * are that file's `/publish*` entries and the types they use, verbatim,
 * comments included, so that the two can be diffed by eye: the publish
 * lifecycle from branch `claude/new-project-studio-saves-0g9ksb`, commit
 * `ecf3b8d`; the publish-job routes (`/publish-requests`, `/publish-jobs`)
 * and `PublishRequestStatus` / `PublishTabJob` from `main`, commit `acb4a49`, with `/ci-runs`.
 *
 * **Copied rather than imported, because it cannot be imported.** That file
 * lives in a private repository which publishes nothing to npm, and its own
 * header says this is how it is kept in step: "We have also used it (by just
 * copying it in and setting the types there) in the @valbuild/server package to
 * check that we are more or less in sync."
 *
 * **When home's `Api.ts` changes, change this with it.** Everything in
 * `protocol.ts` is checked against these types, so a copy brought up to date
 * fails to compile wherever this CLI has not caught up. That is the whole
 * value: without it a wire change is a runtime 500 in somebody's CI, which is
 * how `home` and `@valbuild/server` have already diverged three times - see
 * `homeWireContract.test.ts` in `@valbuild/server` for the last one, and
 * `publishWireContract.test.ts` here for the fixtures that go with these types.
 *
 * A copy is not a guarantee, only a tripwire: nothing checks it against the
 * service, and the parsers in `protocol.ts` are what actually holds at runtime.
 */

import type { Json } from "@valbuild/core";

export type ContentPublishApi = {
  /**
   * Publishing a build, as a resource with a lifecycle.
   *
   * ```
   * POST /publish                  declare  -> an upload slot per MISSING artifact
   * PUT  <presigned url>           upload   -> each artifact, straight to storage
   * POST /publish/{id}/artifacts   confirm  -> the uploads are checked
   * POST /publish/{id}/verify      render   -> a canary build, server side
   * POST /publish/{id}/promote     go live  -> the pointer moves
   * GET  /publish/{id}             status
   * ```
   *
   * Four steps rather than one `POST /publish`, because they fail differently
   * and one call cannot say "the bytes are fine but it did not render" -- which
   * is the sentence a publisher most needs. `promote` is separate from `verify`
   * so that a dry run is the absence of a call rather than a flag.
   *
   * Not keyed by a project, like `/publish-target` above and for the same
   * reason: a project token names one. That is what lets a generated repository
   * hold one secret and no variables at all.
   *
   * ## What is deliberately not here
   *
   * No loader URL, no `vendorRev`, no `x-platform-project`. This service holds
   * the operator relationship with the build platform and calls it; a publisher
   * talks to this API and nothing else. The one exception is the presigned
   * upload URL, which points at object storage -- bytes do not travel through
   * here.
   *
   * It is also what makes this publishable by a project token at all. The
   * platform's own verify step publishes a canary to a throwaway project, and a
   * throwaway has no secrets, so the loader has nothing to check a caller
   * against and refuses with a 503 naming a project nobody has heard of. Behind
   * this API the caller is never involved in that exchange.
   */
  "/publish": {
    POST: {
      body: {
        /** The build's own hash. Repeating it returns the same publish. */
        buildHash: string;
        /** Null only for a seed publish. See `publishPlan.ts`. */
        commit: string | null;
        /** The branch content saves commit to. Required when `commit` is set. */
        branch: string | null;
        /** Which dependency layer this was built against, sent or not. */
        layerRev: string | null;
        /**
         * Whether the app links its own CSS.
         *
         * Build metadata the loader needs and no artifact carries, so it has to
         * be declared. Null is a third answer -- "this build did not say" --
         * and is not false.
         */
        linksOwnCss: boolean | null;
        artifacts: {
          /** See `publishPlan.ts` for the namespace. */
          key: string;
          sha256: string;
          bytes: number;
        }[];
      };
      res: {
        publishId: string;
        state: PublishState;
        project: {
          publicProjectId: string;
          /** Null when the project has no site yet -- reported, not refused. */
          siteUrl: string | null;
        };
        /**
         * One per artifact this project does not already hold, and nothing else.
         *
         * So this doubles as the answer to "what is missing": there is no
         * separate field to keep in step with it. Slots expire; a presigned PUT
         * that answers 403 means declare again, not that the publish failed.
         */
        uploads: {
          key: string;
          url: string;
          method: "PUT";
          headers: Record<string, string>;
          /** ISO 8601. */
          expiresAt: string;
        }[];
        /** Keys already held, so a caller can see what it did not have to send. */
        have: string[];
      };
    };
  };
  "/publish/:publishId": {
    GET: {
      res: {
        publishId: string;
        state: PublishState;
        buildHash: string;
        /** Artifact keys still not uploaded. */
        missing: string[];
        problems: PublishProblem[];
      };
    };
  };
  /** Everything asked for has been uploaded. The uploads are checked here. */
  "/publish/:publishId/artifacts": {
    POST: {
      res: {
        state: PublishState;
        problems: PublishProblem[];
      };
    };
  };
  /** A canary build and render, on the build platform, with our credential. */
  "/publish/:publishId/verify": {
    POST: {
      res: {
        state: PublishState;
        ok: boolean;
        /** Where the canary can be looked at, when it rendered. */
        previewUrl: string | null;
        problems: PublishProblem[];
      };
    };
  };
  /**
   * Move the project's pointer to this build.
   *
   * Refused when the commit is no longer the branch head -- which this service
   * is the authority on (see `getGitHead`), so the rule is enforced where the
   * data already is rather than a round trip away.
   */
  "/publish/:publishId/promote": {
    POST: {
      res: {
        state: PublishState;
        url: string | null;
        commit: string | null;
      };
    };
  };
  /** Exchange a personal access token for a short-lived publish token. */
  "/publish-token": {
    POST: {
      res: {
        /** Shown once, here. Nothing can produce it again. */
        token: string;
        /** ISO 8601, because a `Date` does not survive JSON as one. */
        expiresAt: string | null;
        publicProjectId: string;
        productionUrl: string | null;
      };
    };
  };
  /**
   * Publishing as a queued job: a press of Publish is a REQUEST, and returns
   * at once. A job takes every queued request and everything pending; the tab
   * that pressed runs its prepare (through the Val server), build and upload,
   * reporting each step; then content runs verify and the seal itself. See
   * docs/app-mode.md, "Publishing is a queued job".
   *
   * ```
   * POST /publish-requests             press    -> the request, and a job to build
   * GET  /publish-requests/{id}        where it is: queued, publishing, live, failed
   * POST /publish-requests/try-again   Try again: resume a paused queue, press anew
   * POST /publish-jobs/next            a free tab asks for queued work
   * POST /publish-jobs/{id}/prepare    the job's sources, archived (the Val server's)
   * POST /publish-jobs/{id}/steps      the tab reports build and upload
   * POST /publish-jobs/{id}/renew      the tab is still building
   * POST /publish-jobs/{id}/cancel     Cancel, before the seal
   * POST /publish-jobs/{id}/discard    Discard these changes, on a failed job
   * ```
   *
   * Every id the Studio sends -- a request's, a tab's -- is its own, minted by
   * it, `[A-Za-z0-9_-]{1,100}`. A press is idempotent on its request id; a step
   * report names its step, so one retried after a lost answer does nothing
   * twice.
   */
  /**
   * CI's own report of how a build of a git commit went, sent by the
   * connected workflow's last step with its project token. See `ciRuns.ts`.
   */
  "/ci-runs": {
    POST: {
      body: {
        commit: string;
        branch?: string;
        status: "failed" | "succeeded";
        url?: string;
      };
      res: { recorded: true };
    };
  };
  "/ci-runs/newest": {
    GET: {
      res: {
        run: {
          commit: string;
          status: "failed" | "succeeded";
          url: string | null;
        } | null;
      };
    };
  };
  "/publish-requests": {
    POST: {
      body: { requestId: string; tab: string };
      res: { request: PublishRequestStatus; job: PublishTabJob | null };
    };
  };
  "/publish-requests/try-again": {
    POST: {
      body: { requestId: string; tab: string };
      res: { request: PublishRequestStatus; job: PublishTabJob | null };
    };
  };
  "/publish-requests/:requestId": {
    GET: { res: { request: PublishRequestStatus } };
  };
  "/publish-jobs/next": {
    POST: { body: { tab: string }; res: { job: PublishTabJob | null } };
  };
  "/publish-jobs/:jobId/prepare": {
    POST: {
      /**
       * `/commit`'s body, less what names a commit: the job's commit is minted
       * at the seal. `modules` is required here -- a managed commit's archive,
       * written from it, is the only copy of what it published.
       */
      body: {
        tab: string;
        root: string;
        filesDirectory?: string;
        patchedSourceFiles: Record<string, string | null>;
        patchedBinaryFilesDescriptors: Record<
          string,
          { patchId: string; remote?: boolean }
        >;
        modules: Record<string, { source: Json; schema: Json }>;
        /**
         * Connected: the git commit the Studio's deployment was built from. A
         * branch whose tip is that commit has nothing it has not seen.
         */
        gitCommit?: string;
        /**
         * Connected: the tab can build this job (the deployment embeds its
         * source). Without it, content goes on to the seal with no build and
         * CI builds the push -- which is what a server that predates tab
         * builds gets, since it never says so.
         */
        tabBuilds?: true;
        /**
         * Connected, a deployment built from no commit: its Val source files
         * (modules and `val.modules.*`), by path from the project root, as git
         * blob shas. The content service compares them with the branch when
         * there is no commit to compare from.
         */
        deploymentFiles?: Record<string, string>;
      };
      res: { job: PublishTabJob | null };
    };
  };
  "/publish-jobs/:jobId/steps": {
    POST: {
      body: {
        tab: string;
        step: "prepare" | "build" | "upload";
        ok: boolean;
        /** A finished build step: the id of the publish (`POST /publish`) it declared. */
        build?: string;
        /**
         * Connected, at `build`, instead of `build`: this tab cannot build
         * (no cross-origin isolation, or a deployment that embeds no source).
         * The job goes on without one, and CI builds the push.
         */
        noBuild?: true;
        /**
         * A failed step: why, in the tab's words. The step is still retried;
         * if it fails for good, this is what the editor is told.
         */
        message?: string;
      };
      res: { job: PublishTabJob | null };
    };
  };
  "/publish-jobs/:jobId/renew": {
    POST: { body: { tab: string }; res: { renewed: boolean } };
  };
  "/publish-jobs/:jobId/cancel": {
    POST: { res: { cancelled: boolean } };
  };
  "/publish-jobs/:jobId/discard": {
    POST: {
      /** The forward closure, as `DELETE /patches` takes it. */
      body: { unstagePatchIds?: string[] };
      /** Changes it could not discard: another job in flight holds them. */
      res: { stillHeld: string[] };
    };
  };
};

/**
 * Where a publish is. Mirrors `PublishState` in `utils/publishPlan.ts`, which
 * owns the transition table; this is the wire spelling of it.
 */
export type PublishState =
  | "awaiting-artifacts"
  | "ready"
  | "verified"
  | "live"
  | "failed"
  | "expired";

/**
 * Why a publish is not going anywhere.
 *
 * `code` is the stable half -- a pipeline gates on it -- and carries both this
 * API's own codes (`ARTIFACT_MISMATCH`, `POINTER_STALE`, the declaration codes
 * in `publishPlan.ts`) and the build platform's `PLATFORM*` codes passed
 * through from a verify, because rewording those would lose the only sentence
 * that says what to change.
 *
 * `hint` is not decoration. A gate that merely fails is useless in somebody
 * else's pipeline: they get a red build and no idea why.
 */
export type PublishProblem = {
  code: string;
  message: string;
  hint?: string;
  keys?: string[];
};

/**
 * Where a press of Publish is. `live` names the commit that carries it -- its
 * own, or a newer one that contains it; `failed` names what the editor can do.
 * The same shape as `RequestStatus` in `utils/jobPlan.ts`, which decides it.
 */
export type PublishRequestStatus =
  | { kind: "queued" }
  | { kind: "publishing" }
  | { kind: "live"; commit: string }
  | {
      kind: "failed";
      message: string;
      actions: ("try-again" | "discard" | "re-run-build")[];
      /** The job that failed: what Discard is pressed on. */
      job: string;
    }
  | { kind: "cancelled" }
  | { kind: "nothing-to-publish" };

/** What a tab needs to know about a job it is running. */
export type PublishTabJob = {
  id: string;
  /** The step the tab is to run next; null once the job is content's. */
  step: "prepare" | "build" | "upload" | null;
  /** The recorded commit its build is based on. */
  base: string | null;
  /** The changes its build is to include, on top of `base`. */
  patches: string[];
};
