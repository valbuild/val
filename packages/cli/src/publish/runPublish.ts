import { safeReadGit } from "@valbuild/server";
import path from "path";
import { findAndEvalValConfigFile } from "../utils/evalValConfigFile";
import { collectArtifacts, resolveBuildDir } from "./artifacts";
import {
  PublishClient,
  UploadError,
  createPublishClient,
  pool,
} from "./client";
import { ContentHostError, getContentHost } from "./contentHost";
import { resolvePublishCredential } from "./credentials";
import {
  PendingUpload,
  PublishProblem,
  PublishProtocolError,
  PublishStatus,
} from "./protocol";

export type PublishOptions = {
  root?: string;
  /** The build output to publish. Detected when absent. */
  dir?: string;
  commit?: string;
  branch?: string;
  /** Verify, and stop before the pointer moves. */
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Injected by tests, so polling does not really wait. */
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  timings?: Partial<Timings>;
};

type Timings = {
  pollIntervalMs: number;
  verifyTimeoutMs: number;
  promoteTimeoutMs: number;
};

const DEFAULT_TIMINGS: Timings = {
  pollIntervalMs: 2_000,
  // A canary build and a render, on content's side. Minutes, not seconds, and
  // a CI job that gives up at 60s would abandon publishes that were working.
  verifyTimeoutMs: 15 * 60_000,
  // Moving a pointer is a write. If this takes two minutes something is wrong.
  promoteTimeoutMs: 2 * 60_000,
};

/** How many artifacts go up at once, and how many times a lost one is retried. */
const UPLOAD_CONCURRENCY = 6;
const UPLOAD_ATTEMPTS = 3;
/**
 * How many times we offer the artifacts before giving up.
 *
 * Content re-hashes what landed, so a round that comes back still missing
 * something means bytes were lost rather than refused - a dropped connection,
 * a signature that expired mid-upload. Re-presigning and sending again fixes
 * that; sending it a fourth time is a loop, not a retry.
 */
const ARTIFACT_ROUNDS = 3;

export type PublishResult =
  | {
      status: "published" | "verified";
      publishId: string;
      url: string | null;
      artifacts: number;
      uploaded: number;
      uploadedBytes: number;
    }
  | {
      status: "failed";
      publishId: string;
      state: string;
      message: string;
      problems: PublishProblem[];
    }
  /** Never got as far as a publish: no credential, no build, no commit. */
  | { status: "error"; message: string };

/**
 * Publish a build through content.val.build.
 *
 * Offer the artifacts, upload the ones content does not have, say that is all
 * of them, let content verify by building and rendering a canary, and only
 * then ask it to promote. Every decision in that sequence is content's: this
 * carries bytes and reports back.
 *
 * Content is also the only host involved. It holds the operator relationship
 * with whatever serves the site and calls it on our behalf, which is why there
 * is nothing here that names a site, a loader or a deployment - and why the
 * credential a repository holds can be one token that only publishes.
 */
export async function runPublish(
  options: PublishOptions,
): Promise<PublishResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timings = { ...DEFAULT_TIMINGS, ...options.timings };
  const root = options.root ? path.resolve(options.root) : process.cwd();

  const buildDir = resolveBuildDir({
    root,
    ...(options.dir ? { dir: options.dir } : {}),
  });
  if (buildDir.status === "error") {
    return { status: "error", message: buildDir.message };
  }

  const git = await resolveGit({ root, options, env });
  if (git.status === "error") {
    return git;
  }

  const config = await findAndEvalValConfigFile(root).catch(() => null);
  const credential = await resolvePublishCredential({
    root,
    project: config?.project ?? env.VAL_PROJECT ?? null,
    env,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (credential.status === "error") {
    return { status: "error", message: credential.message };
  }

  const client = createPublishClient({
    host: getContentHost(env),
    token: credential.credential.token,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  log(
    `Publishing ${relative(root, buildDir.dir)}${
      buildDir.wasDetected ? " (pass --dir to publish another directory)" : ""
    } at ${git.commit.slice(0, 7)} on ${git.branch}`,
  );
  const collected = await collectArtifacts(buildDir.dir);
  for (const skipped of collected.skipped) {
    log(`Skipped ${skipped}`);
  }
  if (collected.artifacts.length === 0) {
    return {
      status: "error",
      message:
        `There is nothing in ${buildDir.dir}.\n\n` +
        "Build the project before publishing it.",
    };
  }
  log(
    `${count(collected.artifacts.length, "artifact")}, ${formatBytes(collected.totalBytes)}`,
  );

  try {
    let status = await client.create({
      commit: git.commit,
      branch: git.branch,
      artifacts: collected.artifacts,
    });
    // Counted by path rather than by attempt: an artifact re-offered after a
    // lost upload is the same artifact, and "4 uploaded" out of three is a
    // number nobody can act on.
    const uploadedPaths = new Set<string>();
    let uploadedBytes = 0;
    const sizeOf = new Map(
      collected.artifacts.map((artifact) => [artifact.path, artifact.size]),
    );

    for (let round = 1; round <= ARTIFACT_ROUNDS; round++) {
      if (status.missing.length > 0) {
        const bytes = status.missing.reduce(
          (sum, upload) => sum + (sizeOf.get(upload.path) ?? 0),
          0,
        );
        log(
          round === 1
            ? `Uploading ${count(status.missing.length, "new artifact")}, ${formatBytes(bytes)}` +
                ` (${collected.artifacts.length - status.missing.length} already there)`
            : `Re-uploading ${count(status.missing.length, "artifact")} content did not receive`,
        );
        await uploadAll(client, status.missing, buildDir.dir, sleep);
        for (const upload of status.missing) {
          if (!uploadedPaths.has(upload.path)) {
            uploadedPaths.add(upload.path);
            uploadedBytes += sizeOf.get(upload.path) ?? 0;
          }
        }
      }
      // Always said, even when nothing was uploaded: it is what moves the
      // publish on, and an unchanged build has nothing to send and still has
      // to be published.
      status = await client.artifactsDone(status.publishId);
      if (status.missing.length === 0) {
        break;
      }
    }
    if (status.missing.length > 0) {
      return failure(
        status,
        `${count(status.missing.length, "artifact")} did not reach storage after ${ARTIFACT_ROUNDS} attempts.`,
      );
    }

    log("Verifying: content is building and rendering this as a canary");
    status = await client.verify(status.publishId);
    status = await waitFor(client, status, {
      until: ["verified", "published", "failed"],
      timeoutMs: timings.verifyTimeoutMs,
      pollIntervalMs: timings.pollIntervalMs,
      sleep,
    });
    if (status.phase === "failed") {
      return failure(status, "The canary did not build and render.");
    }

    const summary = {
      publishId: status.publishId,
      artifacts: collected.artifacts.length,
      uploaded: uploadedPaths.size,
      uploadedBytes,
    };
    if (options.dryRun) {
      log("Verified. Stopping here: --dry-run does not move the pointer.");
      return { status: "verified", url: status.url, ...summary };
    }

    if (status.phase !== "published") {
      status = await client.promote(status.publishId);
      status = await waitFor(client, status, {
        until: ["published", "failed"],
        timeoutMs: timings.promoteTimeoutMs,
        pollIntervalMs: timings.pollIntervalMs,
        sleep,
      });
    }
    if (status.phase === "failed") {
      return failure(status, "The pointer was not moved.");
    }
    return { status: "published", url: status.url, ...summary };
  } catch (err) {
    if (err instanceof ContentHostError) {
      return {
        status: "error",
        message:
          err.statusCode === 401 || err.statusCode === 403
            ? `${err.message}\n\nContent refused the credential for this publish. It may have been revoked, or it may belong to another project.`
            : `${err.message}${err.details ? `\n${err.details}` : ""}`,
      };
    }
    if (err instanceof UploadError || err instanceof PublishProtocolError) {
      return { status: "error", message: err.message };
    }
    throw err;
  }
}

function failure(status: PublishStatus, message: string): PublishResult {
  return {
    status: "failed",
    publishId: status.publishId,
    state: status.state,
    message,
    problems: status.problems,
  };
}

async function uploadAll(
  client: PublishClient,
  missing: PendingUpload[],
  dir: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  await pool(missing, UPLOAD_CONCURRENCY, async (upload) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.upload(upload, dir);
        return;
      } catch (err) {
        if (
          attempt >= UPLOAD_ATTEMPTS ||
          !(err instanceof UploadError) ||
          !isWorthRetrying(err)
        ) {
          throw err;
        }
        await sleep(250 * 2 ** attempt);
      }
    }
  });
}

/**
 * Whether to try the same presigned URL again.
 *
 * A dropped connection or a busy bucket, yes. A 403 is an expired or wrong
 * signature and will be a 403 every time - that one is fixed by the next
 * `POST .../artifacts`, which presigns afresh, so it is left to the round.
 */
function isWorthRetrying(err: UploadError): boolean {
  return (
    err.statusCode === 0 || err.statusCode === 429 || err.statusCode >= 500
  );
}

async function waitFor(
  client: PublishClient,
  initial: PublishStatus,
  options: {
    until: PublishStatus["phase"][];
    timeoutMs: number;
    pollIntervalMs: number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<PublishStatus> {
  let status = initial;
  const deadline = Date.now() + options.timeoutMs;
  while (!options.until.includes(status.phase)) {
    if (Date.now() >= deadline) {
      return {
        ...status,
        phase: "failed",
        problems: [
          ...status.problems,
          {
            code: "timeout",
            message: `Content left this publish in "${status.state}" for ${Math.round(
              options.timeoutMs / 1000,
            )}s.`,
            detail: null,
          },
        ],
      };
    }
    await options.sleep(options.pollIntervalMs);
    status = await client.status(status.publishId);
  }
  return status;
}

/**
 * Which commit this build is of, and which branch content commits saves to.
 *
 * Both reach the published build and decide which version of its own content
 * it reads, so a wrong answer is worse than none: what the caller said, then
 * what Val's own variables say, then what the CI runner says, then git.
 *
 * `GITHUB_SHA` before `git rev-parse` because on a `pull_request` event the
 * checkout is a detached merge commit that exists only on the runner, and
 * content committed against it would be committed against nothing.
 */
async function resolveGit(args: {
  root: string;
  options: PublishOptions;
  env: NodeJS.ProcessEnv;
}): Promise<
  | { status: "ok"; commit: string; branch: string }
  | { status: "error"; message: string }
> {
  const { root, options, env } = args;
  const fromGit = await safeReadGit(root);
  const commit =
    options.commit ?? env.VAL_GIT_COMMIT ?? env.GITHUB_SHA ?? fromGit.commit;
  const branchName =
    options.branch ??
    env.VAL_GIT_BRANCH ??
    env.GITHUB_REF_NAME ??
    fromGit.branch;
  // A detached HEAD has no branch, and "HEAD" is not one: content would commit
  // saves to a ref by that name, and the failure would arrive hours later as a
  // save that cannot be published.
  const branch = branchName === "HEAD" ? undefined : branchName;
  if (!commit || !branch) {
    return {
      status: "error",
      message:
        `Could not tell which ${!commit ? "commit" : "branch"} this build is of.\n\n` +
        "Pass --commit and --branch, or set VAL_GIT_COMMIT and VAL_GIT_BRANCH.\n" +
        "They decide which version of its own content the published site reads,\n" +
        "so there is nothing safe to guess.",
    };
  }
  return { status: "ok", commit, branch };
}

function relative(root: string, dir: string): string {
  const rel = path.relative(root, dir);
  return rel === "" || rel.startsWith("..") ? dir : rel;
}

/** "1 artifact", "3 artifacts". Every one of these lines ends up in a CI log. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
