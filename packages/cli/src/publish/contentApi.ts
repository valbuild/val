/**
 * The publish API's types, COPIED from the service that serves them.
 *
 * Source: `content/src/handlers/Api.ts` in valbuild/home, branch
 * `claude/new-project-studio-saves-0g9ksb`, commit `ecf3b8d`. The routes below
 * are that file's `/publish*` entries and the two types they use, verbatim,
 * comments included, so that the two can be diffed by eye.
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
