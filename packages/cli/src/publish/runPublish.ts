import { safeReadGit } from "@valbuild/server";
import path from "path";
import { findAndEvalValConfigFile } from "../utils/evalValConfigFile";
import {
  Artifact,
  buildHashOf,
  collectArtifacts,
  layerRevOf,
  resolveArtifactsDir,
} from "./artifacts";
import {
  PublishClient,
  UploadError,
  createPublishClient,
  isExpiredSlot,
  pool,
} from "./client";
import { ContentHostError, detailText, getContentHost } from "./contentHost";
import { resolvePublishCredential } from "./credentials";
import {
  DeclareResponse,
  PromoteResponse,
  PublishProblem,
  PublishProtocolError,
  PublishState,
  StatusResponse,
  UploadSlot,
  VerifyResponse,
  parseProblems,
} from "./protocol";

export type PublishOptions = {
  root?: string;
  /** The directory whose layout is the artifact namespace. */
  artifacts?: string;
  commit?: string;
  branch?: string;
  /** Name a dependency layer content already holds, instead of sending one. */
  layerRev?: string;
  /** Override the hash the build is identified by. */
  buildHash?: string;
  /** Whether the app links its own CSS. Undefined is "this build did not say". */
  linksOwnCss?: boolean;
  /** Verify, and stop before the pointer moves. */
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

/** How many artifacts go up at once, and how often a lost one is retried. */
const UPLOAD_CONCURRENCY = 6;
const UPLOAD_ATTEMPTS = 3;
/**
 * How many times the publish is declared before giving up.
 *
 * A round ends by declaring again, and there are two reasons to: a slot's hour
 * ran out mid-upload, or content re-hashed what landed and something did not
 * arrive as declared. Both are fixed by fresh slots and sending again. A third
 * round that still does not confirm is not a slow network.
 */
const DECLARE_ROUNDS = 3;

type Summary = {
  publishId: string;
  artifacts: number;
  uploaded: number;
  uploadedBytes: number;
  previewUrl: string | null;
};

export type PublishResult =
  | ({ status: "live"; url: string | null; commit: string | null } & Summary)
  | ({ status: "verified" } & Summary)
  | {
      status: "failed";
      publishId: string | null;
      state: PublishState | null;
      message: string;
      problems: PublishProblem[];
      previewUrl: string | null;
    }
  /** Never got as far as declaring: no credential, no artifacts, no commit. */
  | { status: "error"; message: string };

/**
 * Publish a build through content.val.build.
 *
 * Declare what the build is made of, upload the artifacts content does not
 * already hold, confirm, let content build and render a canary, and only then
 * ask it to promote. Every decision in that sequence is content's; this
 * carries bytes and reports back.
 *
 * Content is also the only host it talks to. Content holds the operator
 * relationship with the build platform and calls it during verify and promote,
 * which is what lets a repository publish with a token that can do nothing
 * else - there is no loader address here, no project id, and no credential
 * that could reach either.
 */
export async function runPublish(
  options: PublishOptions,
): Promise<PublishResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => console.log(line));
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const root = options.root ? path.resolve(options.root) : process.cwd();

  const dir = resolveArtifactsDir({
    root,
    ...(options.artifacts ? { dir: options.artifacts } : {}),
  });
  if (dir.status === "error") {
    return { status: "error", message: dir.message };
  }
  const collected = await collectArtifacts(dir.dir);
  for (const skipped of collected.skipped) {
    log(`Skipped ${skipped}`);
  }
  if (collected.artifacts.length === 0) {
    return {
      status: "error",
      message: `There is nothing in ${dir.dir}. Build the project before publishing it.`,
    };
  }

  const layer = await layerRevOf(collected.artifacts);
  if (layer.status === "error") {
    return { status: "error", message: layer.message };
  }
  const layerRev = options.layerRev ?? layer.layerRev;

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

  const buildHash = options.buildHash ?? buildHashOf(collected.artifacts);
  log(
    `${count(collected.artifacts.length, "artifact")}, ${formatBytes(collected.totalBytes)}` +
      `, at ${git.commit.slice(0, 7)} on ${git.branch}`,
  );

  try {
    return await publishDeclaredBuild({
      client,
      log,
      sleep,
      artifacts: collected.artifacts,
      totalBytes: collected.totalBytes,
      body: {
        buildHash,
        commit: git.commit,
        branch: git.branch,
        layerRev,
        linksOwnCss: options.linksOwnCss ?? null,
        artifacts: collected.artifacts.map(({ key, sha256, bytes }) => ({
          key,
          sha256,
          bytes,
        })),
      },
      dryRun: options.dryRun === true,
    });
  } catch (err) {
    return errorFrom(err);
  }
}

async function publishDeclaredBuild(args: {
  client: PublishClient;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  artifacts: Artifact[];
  totalBytes: number;
  body: Parameters<PublishClient["declare"]>[0];
  dryRun: boolean;
}): Promise<PublishResult> {
  const { client, log, sleep, artifacts, body, dryRun } = args;
  const fileOf = new Map(
    artifacts.map((artifact) => [artifact.key, artifact.file]),
  );
  const bytesOf = new Map(
    artifacts.map((artifact) => [artifact.key, artifact.bytes]),
  );
  const uploadedKeys = new Set<string>();
  let uploadedBytes = 0;
  let publishId: string | null = null;
  let confirmed = false;

  for (let round = 1; round <= DECLARE_ROUNDS && !confirmed; round++) {
    const declared = await declare(client, body);
    if (declared.status === "refused") {
      return {
        status: "failed",
        publishId,
        state: null,
        message: declared.message,
        problems: declared.problems,
        previewUrl: null,
      };
    }
    publishId = declared.response.publishId;
    if (declared.response.state === "live") {
      /*
       * Already published, and not re-opened - re-declaring would mint slots
       * to overwrite the bytes of a build that is currently serving. A CI job
       * re-run after a successful publish lands here, and it is a success.
       */
      log("This build is already live.");
      return {
        status: "live",
        publishId: declared.response.publishId,
        url: declared.response.project.siteUrl,
        commit: body.commit,
        artifacts: artifacts.length,
        uploaded: uploadedKeys.size,
        uploadedBytes,
        previewUrl: null,
      };
    }

    const slots = declared.response.uploads;
    if (slots.length > 0) {
      const bytes = slots.reduce(
        (sum, slot) => sum + (bytesOf.get(slot.key) ?? 0),
        0,
      );
      log(
        round === 1
          ? `Uploading ${count(slots.length, "artifact")}, ${formatBytes(bytes)}` +
              ` (${declared.response.have.length} already held)`
          : `Uploading ${count(slots.length, "artifact")} again`,
      );
      const outcome = await uploadAll({ client, slots, fileOf, sleep });
      for (const key of outcome.uploaded) {
        if (!uploadedKeys.has(key)) {
          uploadedKeys.add(key);
          uploadedBytes += bytesOf.get(key) ?? 0;
        }
      }
      if (outcome.status === "expired") {
        // The hour on the slots ran out while we were using them. Declaring
        // again mints fresh ones; nothing about the publish has failed.
        log("Upload slots expired. Declaring again for fresh ones.");
        continue;
      }
    }

    const confirmation = await confirmArtifacts(
      client,
      declared.response.publishId,
    );
    if (confirmation.status === "mismatch") {
      log(
        `Content did not receive ${count(confirmation.problems.length, "artifact")} as declared. Declaring again.`,
      );
      if (round === DECLARE_ROUNDS) {
        return {
          status: "failed",
          publishId,
          state: null,
          message: "Some artifacts did not arrive as declared.",
          problems: confirmation.problems,
          previewUrl: null,
        };
      }
      continue;
    }
    if (confirmation.state !== "ready") {
      return {
        status: "failed",
        publishId,
        state: confirmation.state,
        message: `Content left this publish in "${confirmation.state}" after confirming the artifacts.`,
        problems: confirmation.problems,
        previewUrl: null,
      };
    }
    confirmed = true;
  }

  if (!confirmed || publishId === null) {
    return {
      status: "failed",
      publishId,
      state: null,
      message: `The artifacts were not confirmed after ${DECLARE_ROUNDS} attempts.`,
      problems: [],
      previewUrl: null,
    };
  }

  log("Verifying: content is building and rendering this as a canary");
  let verified: VerifyResponse | StatusResponse;
  try {
    verified = await client.verify(publishId);
  } catch (err) {
    verified = await recoverWithStatus(err, client, publishId);
  }
  const summary: Summary = {
    publishId,
    artifacts: artifacts.length,
    uploaded: uploadedKeys.size,
    uploadedBytes,
    previewUrl: "previewUrl" in verified ? verified.previewUrl : null,
  };
  const verifiedOk =
    "ok" in verified ? verified.ok : verified.state === "verified";
  if (!verifiedOk) {
    return {
      status: "failed",
      publishId,
      state: verified.state,
      message: "The canary did not build and render, so nothing was promoted.",
      problems: verified.problems,
      previewUrl: summary.previewUrl,
    };
  }

  if (dryRun) {
    log("Verified. Stopping here: --dry-run does not move the pointer.");
    return { status: "verified", ...summary };
  }

  const promoted = await promote(client, publishId);
  if (promoted.status === "stale") {
    return {
      status: "failed",
      publishId,
      state: null,
      message: promoted.message,
      problems: promoted.problems,
      previewUrl: summary.previewUrl,
    };
  }
  if (promoted.response.state !== "live") {
    return {
      status: "failed",
      publishId,
      state: promoted.response.state,
      message: `The pointer was not moved: this publish is "${promoted.response.state}".`,
      problems: [],
      previewUrl: summary.previewUrl,
    };
  }
  return {
    status: "live",
    url: promoted.response.url,
    commit: promoted.response.commit,
    ...summary,
  };
}

type Declared =
  | { status: "ok"; response: DeclareResponse }
  | { status: "refused"; message: string; problems: PublishProblem[] };

async function declare(
  client: PublishClient,
  body: Parameters<PublishClient["declare"]>[0],
): Promise<Declared> {
  try {
    return { status: "ok", response: await client.declare(body) };
  } catch (err) {
    // A malformed declaration is answered with EVERY problem rather than the
    // first, so all of them are carried through to the report.
    if (err instanceof ContentHostError && err.statusCode === 400) {
      return {
        status: "refused",
        message: err.message,
        problems: parseProblems(err.details),
      };
    }
    throw err;
  }
}

async function confirmArtifacts(
  client: PublishClient,
  publishId: string,
): Promise<
  | { status: "ok"; state: PublishState; problems: PublishProblem[] }
  | { status: "mismatch"; problems: PublishProblem[] }
> {
  try {
    const response = await client.confirmArtifacts(publishId);
    return {
      status: "ok",
      state: response.state,
      problems: response.problems,
    };
  } catch (err) {
    if (err instanceof ContentHostError && err.statusCode === 409) {
      // Either nothing is at that key or the bytes are not what was declared.
      // Both are fixed by fresh slots and sending again.
      return { status: "mismatch", problems: parseProblems(err.details) };
    }
    throw err;
  }
}

async function promote(
  client: PublishClient,
  publishId: string,
): Promise<
  | { status: "ok"; response: PromoteResponse }
  | { status: "stale"; message: string; problems: PublishProblem[] }
> {
  try {
    return { status: "ok", response: await client.promote(publishId) };
  } catch (err) {
    if (err instanceof ContentHostError && err.statusCode === 0) {
      // The pointer may well have moved; the answer saying so was lost. Ask.
      const status = await client.status(publishId);
      return {
        status: "ok",
        response: { state: status.state, url: null, commit: null },
      };
    }
    if (err instanceof ContentHostError && err.statusCode === 409) {
      const head = stringField(err.body, "head");
      return {
        status: "stale",
        message:
          "Somebody pushed while this was building, so this build is no longer " +
          "the branch head." +
          (head ? ` The branch is at ${head.slice(0, 7)} now.` : "") +
          "\nThat is a rebuild, not a retry.",
        problems: [
          {
            code: stringField(err.body, "code") ?? "POINTER_STALE",
            message: err.message,
            hint: null,
            keys: [],
          },
        ],
      };
    }
    throw err;
  }
}

/**
 * A step that did not answer is not a step that did not happen.
 *
 * Verify and promote can take minutes on content's side, and a connection that
 * dies in the middle says nothing about what content did. Problems are kept on
 * the row rather than only returned by the call that found them, so asking is
 * not retrying: one `GET` gets the same answer the lost response carried.
 */
async function recoverWithStatus(
  err: unknown,
  client: PublishClient,
  publishId: string,
): Promise<StatusResponse> {
  if (err instanceof ContentHostError && err.statusCode === 0) {
    return client.status(publishId);
  }
  throw err;
}

async function uploadAll(args: {
  client: PublishClient;
  slots: UploadSlot[];
  fileOf: Map<string, string>;
  sleep: (ms: number) => Promise<void>;
}): Promise<{ status: "ok" | "expired"; uploaded: string[] }> {
  const { client, slots, fileOf, sleep } = args;
  const uploaded: string[] = [];
  try {
    await pool(slots, UPLOAD_CONCURRENCY, async (slot) => {
      const file = fileOf.get(slot.key);
      if (file === undefined) {
        // Content asked for a key this build does not have. Declaring again
        // cannot fix that, so it is not a round; it is a bug on one side.
        throw new PublishProtocolError(
          `Content asked for an artifact this build does not have: ${slot.key}`,
        );
      }
      for (let attempt = 1; ; attempt++) {
        try {
          await client.upload(slot, file);
          uploaded.push(slot.key);
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
  } catch (err) {
    if (err instanceof UploadError && isExpiredSlot(err)) {
      return { status: "expired", uploaded };
    }
    throw err;
  }
  return { status: "ok", uploaded };
}

/**
 * Whether to try the same slot again.
 *
 * A dropped connection or a busy store, yes. A 403 is an expired slot and will
 * be a 403 every time - that one is answered by declaring again, which is a
 * round rather than a retry.
 */
function isWorthRetrying(err: UploadError): boolean {
  return (
    err.statusCode === 0 || err.statusCode === 429 || err.statusCode >= 500
  );
}

function errorFrom(err: unknown): PublishResult {
  if (err instanceof ContentHostError) {
    const detail = detailText(err.details);
    return {
      status: "error",
      message:
        err.statusCode === 401 || err.statusCode === 403
          ? `${err.message}\n\nThe credential was refused. A project token can be revoked, and only a token carrying val:publish may publish.`
          : `${err.message}${detail ? `\n${detail}` : ""}`,
    };
  }
  if (err instanceof UploadError || err instanceof PublishProtocolError) {
    return { status: "error", message: err.message };
  }
  throw err;
}

/**
 * Which commit this build is of, and which branch content commits saves to.
 *
 * The commit is baked into the published server and decides which version of
 * its own content the site reads, so a wrong answer is worse than none: what
 * the caller said, then Val's own variables, then the CI runner, then git.
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
  // A detached HEAD has no branch, and "HEAD" is not one: content commits
  // saves to a branch, and the failure would arrive hours later as a save that
  // cannot be published.
  const branch = branchName === "HEAD" ? undefined : branchName;
  if (!commit || !branch) {
    return {
      status: "error",
      message:
        `Could not tell which ${!commit ? "commit" : "branch"} this build is of.\n\n` +
        "Pass --commit and --branch, or set VAL_GIT_COMMIT and VAL_GIT_BRANCH.\n" +
        "The commit is baked into the published site and decides which version of\n" +
        "its own content it reads, so there is nothing safe to guess.",
    };
  }
  return { status: "ok", commit, branch };
}

function stringField(body: unknown, key: string): string | null {
  if (typeof body === "object" && body !== null) {
    const value = Reflect.get(body, key);
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return null;
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
