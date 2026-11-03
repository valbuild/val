/**
 * A fake content.val.build, for the tests that cannot run without one.
 *
 * ## Why this exists
 *
 * Everything else in `e2e/` drives the Studio in `fs` mode, where the "content
 * host" is a directory on disk. That covers the editing surface, but it leaves a
 * whole half of the product untested: in `http` mode (what a deployed app runs)
 * `ValOpsHttp` is the only thing between the Studio and the content service, a
 * publish becomes a git commit through an HTTP call, patches are marked applied
 * rather than deleted, and deployment and build progress arrive over a WebSocket
 * the browser opens itself. None of that has a filesystem equivalent, so none of
 * it was covered.
 *
 * So: an in-memory content service, faithful to the wire protocol
 * `packages/server/src/ValOpsHttp.ts` speaks, plus a `/__test__` control plane
 * that lets a test say "a deployment just started" or "someone pushed a commit"
 * — the two events the Studio reacts to that no editor action can produce.
 *
 * ## Why a separate process rather than request interception
 *
 * `page.route` cannot see any of this. The `ValOpsHttp` calls are made by the
 * Next server, in its own process; only the direct file upload and the WebSocket
 * are made by the browser. Intercepting in the page would mock two endpoints out
 * of thirteen and leave the interesting ones untouched.
 *
 * ## Who calls what
 *
 * Next (`Authorization: Bearer <apiKey>`):
 *   GET    /v1/{project}/applicable/patches         (+ `liveBuild`, `relative_to=live`: S26)
 *   GET    /v1/{project}/chain/version               (the chain version alone: phase 6's head)
 *   POST   /v1/{project}/patches
 *   DELETE /v1/{project}/patches
 *   GET    /v1/{project}/patches/{patchId}/files      (metadata)
 *   PUT    /v1/{project}/files                        (read repo + patch files)
 *   POST   /v1/{project}/commit
 *   POST   /v1/{project}/commit-summary
 *   POST   /v1/{project}/presigned-auth-nonce
 *   POST   /v1/{project}/websocket/nonces
 *   GET    /v1/{project}/settings
 *   GET    /v1/{project}/profiles
 *   POST   /v1/{project}/ai/initialize
 *   GET    /v1/{project}/ai/sessions
 *   PATCH  /v1/{project}/ai/sessions/{sessionId}
 *   GET    /v1/{project}/ai/sessions/{sessionId}/messages
 *   POST   /v1/{project}/patches/{patchId}/files/from-session-file
 *   GET    /v1/{project}/ai/images                    (fs mode mirrors the bytes)
 *   GET    /v1/{project}/commits                      (history: a branch's commits)
 *   GET    /v1/{project}/commits/{sha}/patches        (history: the ops behind one)
 *   GET    /v1/{project}/commits/{sha}/modules        (history: each module's data + schema)
 *   GET    /v1/{project}/commits/{sha}/affected-files (history: what it touched)
 *   GET    /v1/{project}/commits/{sha}/file           (history: one file's bytes then)
 *
 * Next, with a publish token (`POST /v1/{project}/publish-token`):
 *   GET    /v1/project-source                         (by version: `ETag`, 304)
 *   ...    /v1/publish-requests, /v1/publish-jobs, /v1/ci-runs
 *
 * The browser, cross-origin, with `x-val-auth-nonce`:
 *   POST   /v1/{project}/patches/{patchId}/files      (the bytes of an upload)
 *   POST   /v1/{project}/ai/images                    (an image attached in the chat)
 *   WS     /ws                                        (patches, commits, deployments)
 *   WS     /v1/{project}/ai/connect                   (the assistant)
 *
 * ## The assistant
 *
 * The AI half of the protocol is here too, and it is scripted rather than
 * modelled: a test says "this turn calls create_patch with these arguments", the
 * mock plays that over the assistant socket, and the Studio's own tool handlers
 * do the rest. That is the point — the tools are the product surface, the model
 * is not, and a real model would make the assertions non-deterministic without
 * covering a single line more. See `#region ai`.
 *
 * ## What it deliberately does not do
 *
 * No git. A commit records the source text it was handed in an overlay that
 * `PUT /files` reads back, which is enough for a second publish to see the first
 * one's result. The Studio's own sources still come from the modules the Next
 * process imported at startup, exactly as in production between a commit and the
 * deploy that follows it — so after a publish the page shows the pre-publish
 * value until something reloads it. That divergence is real, not an artifact.
 *
 * History is the one place the mock does remember the past. Every commit made
 * through `POST /commit` snapshots the overlay as it stood after that commit and
 * records the same archive `home` writes to object storage — the ops, the
 * pre-commit `.val.ts` text, the affected files — so the `/commits/*` routes can
 * answer for a commit made several commits ago. See `#region history`.
 *
 * No auth flow. `http` mode rejects any request without a session, so the tests
 * mint the `val_session` cookie directly (see `e2e/httpMode.ts`). Login has its
 * own coverage and is not what these tests are for.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

// #region config

const PORT = Number(process.env.MOCK_CONTENT_PORT ?? 4567);
const API_KEY = process.env.MOCK_CONTENT_API_KEY ?? "mock-api-key";
const PROJECT =
  process.env.MOCK_CONTENT_PROJECT ?? "valbuild/val-examples-next";
const PUBLIC_PROJECT_ID =
  process.env.MOCK_CONTENT_PUBLIC_PROJECT_ID ?? "mockproj";
/** Where the repo is on disk, so `location: "repo"` reads can be served. */
const REPO_ROOT = process.env.MOCK_CONTENT_REPO_ROOT ?? process.cwd();
/**
 * The project's own branch, as `home` keeps it: a column on the project.
 *
 * Here because the publisher stopped asserting one. Every route that used to
 * require `branch` now falls back to this when the caller does not say, which
 * is what the real service does with `val_projects.branch` -- and what lets a
 * build with no repository, which bakes no branch, publish at all.
 */
const PROJECT_BRANCH = process.env.MOCK_CONTENT_BRANCH ?? "main";

/**
 * Whether this project's commits are mirrored into a repository.
 *
 * Set by `playwright.config.ts` from the same `VAL_E2E_MANAGED` switch that
 * decides whether the app is given a `VAL_GIT_COMMIT`, so the two halves cannot
 * describe different projects. `connected` by default because that is what the
 * default run builds: an app with a commit baked in.
 *
 * Read once rather than per request -- it is a property of the project, and a
 * mock that could change it mid-run would be modelling something the real
 * service cannot do without a deploy.
 */
const SOURCE_MODE: "managed" | "connected" =
  process.env.MOCK_CONTENT_SOURCE_MODE === "managed" ? "managed" : "connected";

/**
 * The people who can be editing.
 *
 * Fixed rather than generated: a test asserts on the name shown next to a
 * change, and the profile id is also the `sub` of the session cookie it mints,
 * so both ends have to agree on the list.
 */
const PROFILES = [
  {
    profileId: "profile-ada",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    avatar: null,
  },
  {
    profileId: "profile-linus",
    fullName: "Linus Pauling",
    email: "linus@example.com",
    avatar: null,
  },
] as const;

// #endregion

// #region state

type MockPatchFile = {
  /**
   * The file's BYTES.
   *
   * Not a data URL, which is what this held until the content service stopped
   * storing one. That mattered here for a reason worth keeping in view: the
   * service answers `PUT /files` with plain base64 for BOTH locations now,
   * where it used to answer a data URL for `patch` files and plain base64 for
   * `repo` ones - two encodings in one field, told apart only by which branch
   * produced them. Storing bytes is what makes the two branches agree.
   *
   * The upload endpoint still ACCEPTS a data URL, because that is what the
   * browser produces and what published clients send; it is decoded on arrival,
   * exactly as the real service does.
   */
  bytes: Buffer;
  mimeType: string;
  type: "file" | "image";
  metadata: unknown;
  remote: boolean;
  /**
   * How the bytes got here: uploaded by the browser, or moved from an image
   * attached in the AI chat (`from-session-file`), which is a pointer in
   * production and must stay one -- a test tells the two apart by this.
   */
  source: "upload" | "session-file";
};

type MockPatch = {
  patchId: string;
  path: string;
  patch: unknown;
  authorId: string | null;
  baseSha: string;
  createdAt: string;
  parentPatchId: string | null;
  /** Set by a commit. The client reads this as `appliedAt`. */
  applied: { commitSha: string } | null;
  /**
   * The branch the patch is on: the project's, or a proposal's
   * (`val/p/<name>`). `home` keys its chains by branch, so a proposal's
   * patches are a chain of their own, never on the site until a merge.
   */
  branch: string;
  /**
   * Which @valbuild/core wrote the ops. `home` records it on every row and
   * hands it back from `/commits/{sha}/patches`, where the history reader uses
   * it to refuse replaying ops from a version known to replay wrongly.
   */
  coreVersion: string;
};

/** A file as the overlay holds it. `null` is a file a commit deleted. */
type OverlayValue = { encoding: "utf8" | "base64"; value: string } | null;

/**
 * What one commit touched, as `home`'s archive describes it.
 *
 * `gitPath` is repo-relative with no leading slash (`examples/next/content/x.val.ts`),
 * because that is what a git tree entry is called and what the history reader
 * hands back to `/commits/{sha}/file`.
 */
type MockAffectedFile =
  | {
      kind: "module-source" | "json-entry" | "binary";
      gitPath: string;
      change: "added" | "modified" | "deleted";
    }
  | {
      kind: "remote-binary";
      ref: string;
      change: "added" | "modified" | "deleted";
    };

/**
 * Everything about a commit that git would not hold — `home`'s
 * `CommitArchiveV1`, minus the fields only its own storage needs.
 *
 * Recorded at commit time from the same request the overlay is written from.
 * The patch records are COPIED here rather than looked up later, because the
 * ops are what the archive exists to preserve: in `home` the row loses them
 * the moment the archive is written.
 */
type MockCommitArchive = {
  commitSha: string;
  parentCommitSha: string;
  baseSha: string;
  /** 1-based position in `state.commits`; what `home` calls `seq_num`. */
  seqNum: number;
  patches: MockPatch[];
  /**
   * Each `.val.ts` this commit changed: its Source AFTER the commit, as data,
   * and the serialized schema it was written under — exactly what the client
   * sent as `modules`. `source: null` is a module the commit deleted.
   *
   * Held as values rather than as `home`'s content hashes, because the mock has
   * no blob store to point into; the hashes it reports are computed from these
   * the same way `home`'s `blobSha` computes them.
   */
  modules: Record<string, { source: unknown; schema: unknown }>;
  affectedFiles: MockAffectedFile[];
};

type MockCommit = {
  commitSha: string;
  clientCommitSha: string;
  parentCommitSha: string;
  commitMessage: string | null;
  branch: string;
  creator: string;
  createdAt: string;
};

/** Where a press of Publish is: `PublishRequestStatus` in `@valbuild/shared`. */
type MockPublishRequestStatus =
  | { kind: "queued" }
  | { kind: "publishing" }
  | { kind: "live"; commit: string }
  | {
      kind: "failed";
      message: string;
      actions: ("try-again" | "discard" | "re-run-build")[];
      job: string;
    }
  | { kind: "cancelled" }
  | { kind: "nothing-to-publish" };

type MockPublishRequest = {
  requestId: string;
  status: MockPublishRequestStatus;
  /** The job carrying it, once one does. */
  jobId: string | null;
};

type MockPublishJob = {
  id: string;
  /** The tab holding it, which is the only one whose reports count. */
  tab: string;
  /** The step the tab runs next; null once it is the mock's (sealed, or failed). */
  step: "prepare" | "build" | "upload" | null;
  base: string;
  patches: string[];
  requestIds: string[];
  /** What the prepare was sent: what the seal records. */
  prepared: CommitBody | null;
  done: "sealed" | "failed" | "cancelled" | null;
};

type MockDeployment = {
  deploymentId: string;
  commitSha: string;
  deploymentState: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * One image the browser attached in the chat, as the content service holds it.
 *
 * Keyed by an opaque `key` because that is the only handle the assistant ever
 * gets: the model is told the key, names it in a tool call, and the Studio asks
 * the content service to turn it into a patch file. Nothing in that chain sees
 * the bytes, which is exactly the part worth testing.
 */
type MockAiImage = {
  key: string;
  sessionId: string;
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
};

/**
 * What the scripted assistant does for one turn.
 *
 * A `tool` step sends an `ai_tool_call` and BLOCKS until the Studio answers with
 * the matching `ai_tool_result` — the same rule the real service follows, and the
 * reason a test can assert on what a tool returned rather than only on what the
 * UI drew.
 */
type AiScriptStep =
  | { type: "text"; text: string }
  | {
      type: "tool";
      name: string;
      arguments?: unknown;
      /** How long to wait for the result. `null` waits indefinitely. */
      timeoutMs?: number | null;
    }
  /**
   * An `ai_usage` report — sent only if the prompt asked for them
   * (`reportUsage`), as the real service does.
   */
  | { type: "usage"; outputTokens: number; estimated?: boolean };

type AiScript = {
  steps: AiScriptStep[];
  /** The assistant's closing message. */
  response?: string;
  /** The turn's exact output tokens, sent with `ai_response`. */
  outputTokens?: number;
};

/** A tool call the assistant made, and what the Studio answered. */
type RecordedToolCall = {
  name: string;
  arguments: unknown;
  result: unknown;
  isError: boolean;
};

/** A prompt the Studio sent, flattened to the parts a test asserts on. */
type RecordedPrompt = {
  sessionId: string | null;
  text: string;
  imageKeys: string[];
};

type MockAiSession = {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The conversation so far, as `/ai/sessions/{id}/messages` reports it.
   *
   * Kept because reloading a conversation is a real feature and the studio uses
   * it for something a test can see: the assistant panel unmounts when it is
   * closed, so what is on screen after reopening it comes from HERE rather than
   * from anything the browser still held.
   */
  messages: { role: "user" | "assistant"; content: string }[];
};

type State = {
  /** Insertion-ordered: this is the patch chain. */
  patches: Map<string, MockPatch>;
  /** Proposals, by name: see the proposals region. */
  proposals: Map<string, MockProposal>;
  /**
   * Whether this project has proposals turned on. OFF by default, as in
   * `home`, where every proposals route answers 404 until they are: a
   * Studio that finds them on offers to open one, which every spec but the
   * proposal ones was written without.
   */
  proposalsEnabled: boolean;
  /**
   * Uploaded bytes, keyed by patch id and then by file path.
   *
   * Kept apart from the patch records because the client uploads a patch's files
   * BEFORE it saves the patch — so for a moment there are bytes belonging to a
   * patch that does not exist yet. Holding them inside the patch map meant
   * inventing a placeholder patch, and that placeholder then became the head of
   * the chain (so the real save was refused as a conflict) and was handed out by
   * `applicable/patches` with no ops (so `/save` crashed on it).
   */
  patchFiles: Map<string, Map<string, MockPatchFile>>;
  commits: MockCommit[];
  deployments: MockDeployment[];
  /**
   * Committed file content, layered over the working tree.
   *
   * `null` means the commit deleted the file. Read back by `PUT /files` with
   * `location: "repo"`, so a second publish prepares against the first one's
   * result rather than against whatever is on disk.
   *
   * The encoding travels with the value because a commit carries two different
   * kinds of file: source text, which arrives as a string, and image bytes, which
   * arrive as base64. Storing both as "a string" and reading both back as UTF-8
   * silently corrupts every byte outside ASCII — so the bytes are kept as base64
   * and only decoded on the way out.
   */
  repoOverlay: Map<string, OverlayValue>;
  /**
   * The overlay as it stood right after each commit, keyed by commit sha.
   *
   * What lets a file be read AT a commit rather than only at the head. A
   * snapshot is a copy of the whole overlay, which is fine here — the overlay
   * only ever holds what commits wrote, and a test makes a handful of them. A
   * key missing from a snapshot means no commit up to that point touched the
   * file, so the working tree is what it looked like.
   */
  snapshots: Map<string, Map<string, OverlayValue>>;
  /**
   * The archive `home` would have written for each commit, keyed by sha.
   *
   * Only commits made through `POST /commit` have one. A commit pushed through
   * the control plane deliberately has none: that is what a commit from before
   * archiving shipped looks like, and the history reader has to cope with it
   * (`hasArchive: false`, patches still readable, no pre-commit sources).
   */
  archives: Map<string, MockCommitArchive>;
  /** Bytes of files a commit moved out to remote storage, keyed by remote ref. */
  remoteFiles: Map<string, string>;
  /** Nonces handed out by `presigned-auth-nonce` and `websocket/nonces`. */
  nonces: Set<string>;
  /** The commit the mock considers current, i.e. what a new build would carry. */
  headCommitSha: string;
  /** Images attached in the chat, by the key the content service handed back. */
  aiImages: Map<string, MockAiImage>;
  /** Chat sessions, as `/ai/sessions` reports them. */
  aiSessions: Map<string, MockAiSession>;
  /** Queued turns: one is consumed by each `ai_prompt`. */
  aiScripts: AiScript[];
  /** Every prompt the Studio has sent. */
  aiPrompts: RecordedPrompt[];
  /** Every tool call played, with the Studio's answer. */
  aiToolCalls: RecordedToolCall[];
  /**
   * Refuse to start the assistant, so the studio runs out of attempts.
   *
   * The one AI failure a test cannot produce by asking for it: the studio tries
   * five times before it gives up and says so, and there is no editor action
   * that makes `/ai/initialize` fail.
   */
  aiOffline: boolean;
  /**
   * Whether `from-session-file` hands back each image's SHA-256, as home does
   * since it started to. Off is a content service that predates it, which the
   * Studio still has to name remote files against.
   */
  aiSessionSha256: boolean;
  /**
   * Whether this project publishes as JOBS (`project.publishJobs` on the
   * overlay). OFF by default: a connected project that commits is what every
   * other spec here was written against. See the publish jobs region.
   */
  publishJobsEnabled: boolean;
  /** Publish tokens minted by `/publish-token`: the publish API's credential. */
  publishTokens: Set<string>;
  /** Presses of Publish, by the request id the Studio minted. */
  publishRequests: Map<string, MockPublishRequest>;
  /** Publish jobs, by id. */
  publishJobs: Map<string, MockPublishJob>;
  /**
   * The files the project's live build was made from (`GET /v1/project-source`),
   * as the platform keeps them (`source:<project>`); `null`: never published.
   * Set by a test (`PUT /__test__/project-source`), as a publish would.
   */
  projectSource: Record<string, string> | null;
};

function emptyState(): State {
  return {
    patches: new Map(),
    proposals: new Map(),
    proposalsEnabled: false,
    patchFiles: new Map(),
    commits: [],
    deployments: [],
    repoOverlay: new Map(),
    snapshots: new Map(),
    archives: new Map(),
    remoteFiles: new Map(),
    nonces: new Set(),
    headCommitSha: process.env.MOCK_CONTENT_INITIAL_COMMIT ?? "mockcommit0",
    aiImages: new Map(),
    aiSessions: new Map(),
    aiScripts: [],
    aiPrompts: [],
    aiToolCalls: [],
    aiOffline: false,
    aiSessionSha256: true,
    publishJobsEnabled: false,
    publishTokens: new Set(),
    publishRequests: new Map(),
    publishJobs: new Map(),
    projectSource: null,
  };
}

let state = emptyState();

/** Every subscribed browser. Written to by the control plane and by commits. */
const sockets = new Set<WebSocket>();
/** The branch each socket's chain messages are about, from its nonce. */
const socketBranch = new WeakMap<WebSocket, string>();
const socketBranchOfNonce = new Map<string, string>();
/** How many sockets have ever been accepted. Only ever increases. */
let socketsAccepted = 0;

/**
 * The `Origin` of the request each response belongs to.
 *
 * A side table rather than a property hung off the response, so that
 * `corsHeaders` can reflect the caller's origin back without a cast: the browser
 * sends credentials with its uploads, and `Access-Control-Allow-Origin: *` is not
 * allowed to be combined with `Allow-Credentials`.
 */
const requestOrigins = new WeakMap<ServerResponse, string>();

// #endregion

// #region helpers

function nowIso(): string {
  return new Date().toISOString();
}

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...corsHeaders(res),
  });
  res.end(payload);
}

/**
 * CORS, because the browser uploads patch files straight to this host.
 *
 * `x-val-auth-nonce` has to be allowed explicitly: it is not a CORS-safelisted
 * header, so without it the preflight fails and the upload never happens — and
 * what the Studio shows for that is a stuck progress bar, not an error.
 */
function corsHeaders(res: ServerResponse): Record<string, string> {
  const origin = requestOrigins.get(res);
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "content-type, authorization, x-val-pat, x-val-auth-nonce",
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  };
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return (await readRawBody(req)).toString("utf-8");
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | undefined> {
  const raw = await readBody(req);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Whether a request is allowed to talk to the content service.
 *
 * Checked against the configured key rather than merely required to be present:
 * a wrongly wired `VAL_API_KEY` is a real failure mode, and one that otherwise
 * shows up as an empty patch list.
 */
function authorized(req: IncomingMessage): boolean {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth === `Bearer ${API_KEY}`) {
    return true;
  }
  if (typeof req.headers["x-val-pat"] === "string") {
    return true;
  }
  const nonce = req.headers["x-val-auth-nonce"];
  return typeof nonce === "string" && state.nonces.has(nonce);
}

/** The last patch in a branch's chain, which is what a new patch must name as parent. */
function headPatchId(branch: string = PROJECT_BRANCH): string | null {
  let last: string | null = null;
  for (const patch of state.patches.values()) {
    if (patch.branch === branch) last = patch.patchId;
  }
  return last;
}

/** A branch's chain, in order. */
function patchesOn(branch: string): MockPatch[] {
  return [...state.patches.values()].filter((patch) => patch.branch === branch);
}

/**
 * Tell every subscriber what the chain is now.
 *
 * The WHOLE chain, not the ids that just changed: `useStatus` handles a `patches`
 * message by REPLACING `stat.data.patches` with what the message carries, so
 * sending only the new id would announce that every other patch had vanished.
 * Anything that adds to or removes from the chain has to call this.
 */
/**
 * The chain's version, as `home` keeps it in `val_patch_chains`: bumped by
 * every write and every delete, and reported with the head -- and once by each
 * deployment that goes live (see {@link countDeploymentLive}). Never reset, so
 * it only ever goes up across `/__test__/reset` too — as a real one would.
 */
let chainVersion = 0;
/**
 * The deployments that moved {@link chainVersion}, by branch and id, in the
 * order they were counted: `home`'s `val_chain_deployments`, which only a
 * deployment's first `success` inserts into. Each with the BUILD it names, as
 * `home` resolves one (`patches.liveBuild`): `build:<hash>` for a publish's
 * build (here: a deployment reported with `build`), `commit:<sha>` for a
 * GitHub deployment's commit. Emptied with the rest of the state on reset: a
 * test names its own deployments, and a project made afresh has counted none.
 */
let countedDeployments: Array<{
  key: string;
  branch: string;
  deployment: string;
  version: number;
  build: string;
}> = [];

/**
 * The base each build reported (`sources_sha` on `/applicable/patches`), by
 * the build it asked as: `home`'s `val_build_bases`. See {@link liveBuildOf}.
 */
let buildBases = new Map<string, string>();

/**
 * A deployment went live for `branch`: what `home`'s `writeDeployment` does
 * with a `success` (`patches.countDeploymentLive`). The chain version moves
 * once per deployment, however many times it is reported, with nothing in
 * the chain changed -- a new build's answers are newer than the last build's,
 * and the version is what orders answers (Val's `ProjectVersion.seq` in http
 * mode). Says whether it moved.
 */
function countDeploymentLive(
  branch: string,
  deploymentId: string,
  build: string,
): boolean {
  const key = `${branch}\0github:${deploymentId}`;
  if (countedDeployments.some((counted) => counted.key === key)) return false;
  chainVersion += 1;
  countedDeployments.push({
    key,
    branch,
    deployment: `github:${deploymentId}`,
    version: chainVersion,
    build,
  });
  return true;
}

/**
 * The build a caller asks as, as `home`'s `callerBuildOf` spells it: the
 * platform's build when it names one, else its commit; none on a proposal's
 * branch, whose builds are never counted on the site's chain.
 */
function callerBuildOf(url: URL, onProposal: boolean): string | null {
  if (onProposal) return null;
  const build = url.searchParams.get("build");
  if (build !== null) return `build:${build}`;
  const commit = url.searchParams.get("commit");
  return commit !== null ? `commit:${commit}` : null;
}

/**
 * `liveBuild` on `/applicable/patches`, as `home`'s `liveBuildFor` answers
 * it: the deployment counted last on `branch`, the base its build reported,
 * and whether `callerBuild` went live before it -- never for a build not
 * counted at all, which is the newest one answering before it was reported.
 */
function liveBuildOf(branch: string, callerBuild: string | null) {
  const counted = countedDeployments.filter((c) => c.branch === branch);
  const live = counted[counted.length - 1];
  if (live === undefined) return null;
  const callers =
    callerBuild === null || callerBuild === live.build
      ? []
      : counted.filter((c) => c.build === callerBuild);
  const callerVersion = callers[callers.length - 1]?.version;
  return {
    deployment: live.deployment,
    version: live.version,
    sourcesSha: buildBases.get(live.build) ?? null,
    callerIsPrevious:
      callerVersion !== undefined && callerVersion < live.version,
  };
}
/** The version each save made, so a retried save answers with its own. */
const versionOfPatch = new Map<string, number>();

function broadcastChain(branch: string = PROJECT_BRANCH): void {
  // To the sockets of that branch's Studios only: a nonce names its branch.
  const site = patchesOn(branch);
  broadcast(
    {
      type: "patches",
      patches: site.map((patch) => patch.patchId),
      // Beside the list, as `home` sends it. Here the two always agree — this
      // mock lists the whole chain — but a client that stopped reading the head
      // would fall back to the list and nothing here could tell.
      headPatchId: headPatchId(branch),
      headVersion: chainVersion,
      // Which of them a publish has already applied, as `home` sends it.
      appliedPatches: site
        .filter((patch) => patch.applied !== null)
        .map((patch) => patch.patchId),
    },
    branch,
  );
}

/** To every socket, or to the sockets of one branch's Studios. */
function broadcast(message: unknown, branch?: string): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (
      branch !== undefined &&
      (socketBranch.get(socket) ?? PROJECT_BRANCH) !== branch
    ) {
      continue;
    }
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

/**
 * The path inside a remote ref, or null if this is not one.
 *
 * The two ends of a remote upload disagree about keys, and the content service is
 * what reconciles them: the browser uploads bytes under the FILE PATH (the store
 * splits the ref before sending), while `prepare` describes the file to commit by
 * its full REF. So a commit that names
 * `https://remote.val.build/file/p/{project}/b/{bucket}/v/{version}/h/{hash}/f/{fileHash}/p/public/x/y.png`
 * has to find bytes stored under `/public/x/y.png`.
 *
 * The pattern mirrors `Internal.remote.splitRemoteRef`, duplicated rather than
 * imported because `@valbuild/core` is not resolvable from the repository root
 * and the mock is meant to run with nothing built.
 */
const REMOTE_REF =
  /^https?:\/\/[^/]+\/file\/p\/[^/]+\/b\/[^/]+\/v\/[^/]+\/h\/[^/]+\/f\/[^/]+\/p\/(public\/.+)$/;

function pathInRemoteRef(ref: string): string | null {
  const match = ref.match(REMOTE_REF);
  return match ? `/${match[1]}` : null;
}

/**
 * Read a repo file: the overlay if a commit wrote it, otherwise the working tree.
 *
 * `root` comes from the request (`val.config`'s `root`, e.g. `/examples/next`)
 * and `filePath` is module-relative, so the two have to be joined here rather
 * than baked into `REPO_ROOT`.
 */
async function readRepoFile(
  root: string,
  filePath: string,
): Promise<{ value: string } | { error: string }> {
  const key = path.posix.join(root || "/", filePath);
  const overlaid = state.repoOverlay.get(key);
  if (overlaid !== undefined) {
    if (overlaid === null) {
      return { error: `File was deleted by a commit: ${key}` };
    }
    // A repo read answers with plain base64, whatever the value was stored as.
    return {
      value:
        overlaid.encoding === "base64"
          ? overlaid.value
          : Buffer.from(overlaid.value, "utf-8").toString("base64"),
    };
  }
  const onDisk = path.join(REPO_ROOT, key);
  try {
    const bytes = await readFile(onDisk);
    return { value: bytes.toString("base64") };
  } catch (err) {
    return {
      error: `Could not read ${key}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * A repo file as it was AT a commit, rather than at the head.
 *
 * `PUT /files` deliberately does not do this — it answers the latest overlay
 * whatever `commitSha` it is handed, because the app's own commit never moves
 * between deploys and a second publish has to prepare against the first one's
 * result (see {@link readRepoFile}). History is the one reader that means the
 * sha literally, so it gets its own lookup: the snapshot taken after that
 * commit, falling through to the working tree for files no commit ever touched.
 *
 * `gitPath` is repo-relative (`examples/next/content/x.val.ts`), with or without
 * a leading slash; the overlay keys carry one, so it is normalised here.
 */
async function readFileAtCommit(
  commitSha: string,
  gitPath: string,
): Promise<{ bytes: Buffer } | { status: 404; error: string }> {
  const key = "/" + gitPath.replace(/^\/+/, "");
  const initialCommit =
    process.env.MOCK_CONTENT_INITIAL_COMMIT ?? "mockcommit0";
  let overlaid: OverlayValue | undefined;
  if (commitSha === initialCommit) {
    // Nothing had been committed yet: the working tree IS that commit.
    overlaid = undefined;
  } else {
    const snapshot = state.snapshots.get(commitSha);
    if (!snapshot) {
      return {
        status: 404,
        error: `No commit ${commitSha} created by Val in this project`,
      };
    }
    overlaid = snapshot.get(key);
  }
  if (overlaid === null) {
    return {
      status: 404,
      error: `File was deleted by commit ${commitSha}: ${key}`,
    };
  }
  if (overlaid !== undefined) {
    return {
      bytes: Buffer.from(
        overlaid.value,
        overlaid.encoding === "base64" ? "base64" : "utf-8",
      ),
    };
  }
  try {
    return { bytes: await readFile(path.join(REPO_ROOT, key)) };
  } catch (err) {
    return {
      status: 404,
      error: `File not found at commit ${commitSha}: ${key} (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }
}

/**
 * The content type for a file, from its extension.
 *
 * A short list rather than a dependency: the history file route exists so an
 * `<img>` can point at it, and these are the kinds of file a Val project puts
 * under `/public/val`.
 */
function mimeTypeOf(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const known: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    json: "application/json",
    txt: "text/plain",
    ts: "text/plain",
    js: "text/javascript",
  };
  return known[ext] ?? "application/octet-stream";
}

/**
 * What kind of file a git path is, the way `home`'s `classifyAffectedFile`
 * decides it: by suffix, and anything that is neither a module nor an entry is
 * a binary the history reader can only offer as bytes.
 */
function classifyAffectedFile(
  gitPath: string,
): "module-source" | "json-entry" | "binary" {
  if (gitPath.endsWith(".val.ts") || gitPath.endsWith(".val.js")) {
    return "module-source";
  }
  if (gitPath.endsWith(".val.json")) {
    return "json-entry";
  }
  return "binary";
}

// #endregion

// #region endpoints

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => Promise<void> | void;

/**
 * `GET /v1/{project}/chain/version`
 *
 * The branch's chain version alone -- the `headVersion` every
 * `applicable/patches` answer carries -- for "has the chain moved?" without
 * reading the chain (`ValOpsHttp.chainSeq`, the head of phase 6). As home's
 * `getChainVersion` answers it, from `readChainVersion`. One counter here for
 * every branch, as `headVersion` is.
 */
const getChainVersion: Handler = (_req, res) => {
  json(res, 200, { headVersion: chainVersion });
};

/**
 * `GET /v1/{project}/applicable/patches`
 *
 * The whole chain, in order, optionally filtered to `patch_id`s and optionally
 * without the ops. Commits and deployments ride along on the same response —
 * that is where `/stat` gets them from, and in turn where the Studio's
 * deployment banner comes from.
 */
const getApplicablePatches: Handler = (req, res, url) => {
  const requested = url.searchParams.getAll("patch_id");
  const excludeOps = url.searchParams.get("exclude_patch_ops") === "true";
  const wanted = requested.length > 0 ? new Set(requested) : null;
  /*
   * The caller's own base, reported (`sources_sha`), and whether it wants the
   * chain relative to the live build (`relative_to=live`): `home`'s answer to
   * Val's S26 (`utils/liveBuild.ts` there). Refused as `home` refuses them.
   */
  const sourcesSha = url.searchParams.get("sources_sha");
  if (sourcesSha !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(sourcesSha)) {
    json(res, 400, { message: "Invalid sources_sha: not a base's hash" });
    return;
  }
  const relativeTo = url.searchParams.get("relative_to");
  if (relativeTo !== null && relativeTo !== "live") {
    json(res, 400, {
      message: "Invalid relative_to: the only one there is is 'live'",
    });
    return;
  }
  /*
   * The branch's chain: the project's when the caller does not say, as
   * `home` resolves it from the project row. A proposal's server names its
   * branch and the save its snapshot is (`commit`), and is answered with what
   * came after that save and nothing else: the snapshot already holds the
   * saves up to it, and their patches applied again would apply twice.
   */
  const branch = url.searchParams.get("branch") ?? PROJECT_BRANCH;
  const position = url.searchParams.get("commit");
  const proposal = proposalOnBranch(branch);
  const saved =
    proposal !== null && position !== null
      ? savesUpTo(proposal, position)
      : null;
  const callerBuild = callerBuildOf(url, proposal !== null);
  if (sourcesSha !== null && callerBuild !== null) {
    buildBases.set(callerBuild, sourcesSha);
  }
  // Only for a caller that reports or asks, as `home` answers it.
  const live =
    proposal !== null || (sourcesSha === null && relativeTo === null)
      ? null
      : liveBuildOf(branch, callerBuild);
  /*
   * At the live build when the caller is a previous one and the live build's
   * base is known. This mock lists the WHOLE chain whatever the position (see
   * the head below), so only what the answer says it is relative to differs.
   */
  const atLive =
    relativeTo === "live" &&
    live !== null &&
    live.callerIsPrevious &&
    live.sourcesSha !== null;
  const patches = [];
  for (const patch of patchesOn(branch)) {
    if (wanted && !wanted.has(patch.patchId)) {
      continue;
    }
    if (
      saved !== null &&
      patch.applied !== null &&
      saved.has(patch.applied.commitSha)
    ) {
      continue;
    }
    patches.push({
      path: patch.path,
      patch: excludeOps ? null : patch.patch,
      patchId: patch.patchId,
      authorId: patch.authorId,
      baseSha: patch.baseSha,
      createdAt: patch.createdAt,
      applied: patch.applied,
    });
  }
  json(res, 200, {
    patches,
    /*
     * The head of the chain, which a writer names as its parent. `home` reports
     * it because its list leaves out what the caller's build contains; this
     * mock's list does not, so the head is simply the last patch — and it is
     * the whole chain's last patch whatever `patch_id` filter was asked for.
     */
    headPatchId: headPatchId(branch),
    headVersion: chainVersion,
    commits: state.commits.filter((commit) => commit.branch === branch),
    /**
     * Newest update first, as the content service returns them.
     *
     * `getByCommitShas` is `ORDER BY updated_at DESC`, and the client folds the
     * list into one entry per commit sha — so the order decides which state
     * survives when a commit has been deployed more than once. Insertion order
     * would have been the friendlier answer and the wrong one.
     */
    deployments: [...state.deployments].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    ),
    /*
     * What the project expects of whoever publishes it.
     *
     * Saying it is not decoration: `ValOpsHttp` reads it to decide whether a
     * deployment can publish, and the Studio reads it to decide whether a
     * publish is something a host will finish or something the browser already
     * has -- so a mock that stayed silent would leave both untested in the one
     * suite that exercises http mode end to end.
     *
     * It follows the RUN rather than being fixed, because it has to agree with
     * the app: `playwright.config.ts` gives the app a `VAL_GIT_COMMIT` unless
     * `VAL_E2E_MANAGED` is set, and a project the content service calls managed
     * cannot have a deployment built from a commit. This said `managed`
     * unconditionally while the default run said otherwise, which went
     * unnoticed while the only reader asked about the pair.
     */
    project: {
      sourceMode: SOURCE_MODE,
      branch: PROJECT_BRANCH,
      // Said only when on: absent is what a content service that predates
      // jobs sends, and what every spec but the job ones runs against.
      ...(state.publishJobsEnabled ? { publishJobs: true } : {}),
    },
    ...(live !== null ? { liveBuild: live } : {}),
    ...(relativeTo === "live"
      ? { relativeTo: atLive ? "live" : "caller" }
      : {}),
  });
};

/**
 * `POST /v1/{project}/patches` — save one patch.
 *
 * The parent check is the real contract, not decoration: the chain is linear and
 * single-writer, and a patch whose parent is no longer the head is a 409 the
 * client is built to recover from. Two editors racing is the case that produces
 * it, which is exactly one of the things these tests are for.
 *
 * A parent that DOES NOT EXIST is a different answer, and the difference is the
 * whole of `e2e/http/discard.spec.ts`. The real content service answers a
 * missing parent with `Parent patch not found` and a status that is not 409, and
 * that distinction decides what the Studio does with the edit: `ValOpsHttp` maps
 * 409 to `patch-head-conflict`, which `PatchSync` re-syncs and RETRIES, and
 * anything else to `other`, which `ValServer` turns into a 400 `patch-error` and
 * `PatchSync` treats as permanently rejected — the patch is dropped and the
 * user's edit is gone. Answering both cases 409, as this used to, made the mock
 * forgiving of exactly the bug that loses an edit after a discard.
 */
const savePatch: Handler = async (req, res) => {
  const body = await readJsonBody<{
    path: string;
    patch: unknown;
    authorId: string | null;
    patchId: string;
    parentPatchId: string | null;
    baseSha: string;
    branch?: string;
    coreVersion?: string | null;
  }>(req);
  if (!body || typeof body.patchId !== "string") {
    json(res, 400, { message: "Invalid save-patch body" });
    return;
  }
  if (state.patches.has(body.patchId)) {
    // Idempotent: the client retries a save it did not get an answer to.
    json(res, 200, {
      patchId: body.patchId,
      headVersion: versionOfPatch.get(body.patchId) ?? chainVersion,
    });
    return;
  }
  const parentPatchId = body.parentPatchId ?? null;
  if (parentPatchId !== null && !state.patches.has(parentPatchId)) {
    // Gone, not merely stale: nothing the client can re-sync to makes this id
    // exist again. JSON with a `message`, because that is what `ValOpsHttp`
    // reads a non-409 body as — a text body would reach the user as the status
    // line instead of as this sentence.
    //
    // `home` answers this 409 now (a vanished parent is a head that moved), but
    // a content service deployed before that still answers 404, and the Studio
    // has to survive it. So the mock keeps the harsher answer: it is the one
    // that loses an edit if the client regresses.
    json(res, 404, { message: "Parent patch not found" });
    return;
  }
  const branch = body.branch ?? PROJECT_BRANCH;
  const onProposal = proposalOnBranch(branch);
  if (branch !== PROJECT_BRANCH && onProposal === null) {
    json(res, 400, { message: `No proposal is on branch '${branch}'` });
    return;
  }
  if (onProposal !== null && onProposal.status !== "open") {
    json(res, 409, {
      message: `The proposal is ${onProposal.status}: nothing more is written into it.`,
    });
    return;
  }
  const head = headPatchId(branch);
  if (parentPatchId !== head) {
    res.writeHead(409, { "Content-Type": "text/plain", ...corsHeaders(res) });
    res.end(
      `Parent patch ${parentPatchId ?? "<head>"} is not the head of the chain (${head ?? "<empty>"})`,
    );
    return;
  }
  state.patches.set(body.patchId, {
    patchId: body.patchId,
    path: body.path,
    patch: body.patch,
    authorId: body.authorId ?? null,
    baseSha: body.baseSha,
    createdAt: nowIso(),
    parentPatchId: body.parentPatchId ?? null,
    applied: null,
    branch,
    // `home` stores whatever the client says it is, NOT NULL. A client that
    // sends none gets a value that is obviously not a release, so a test
    // reading it back cannot mistake the default for a real version.
    coreVersion: body.coreVersion ?? "0.0.0-mock",
  });
  // The chain moved; the broadcast reads it at this version.
  chainVersion += 1;
  versionOfPatch.set(body.patchId, chainVersion);
  const headVersion = chainVersion;
  broadcastChain(branch);
  json(res, 200, {
    patchId: body.patchId,
    createdAt: nowIso(),
    headVersion,
  });
};

/** `DELETE /v1/{project}/patches` — what discard and the auto-delete path call. */
const deletePatches: Handler = async (req, res) => {
  const body = await readJsonBody<{
    patchIds: string[];
  }>(req);
  const ids = body?.patchIds ?? [];
  // A delete can move the head backwards, so the chain moves on a version.
  const branches = new Set(
    ids.flatMap((patchId) => {
      const patch = state.patches.get(patchId);
      return patch === undefined ? [] : [patch.branch];
    }),
  );
  const moved = branches.size > 0;
  if (moved) {
    chainVersion += 1;
  }
  for (const patchId of ids) {
    state.patches.delete(patchId);
    state.patchFiles.delete(patchId);
  }
  for (const branch of branches) broadcastChain(branch);
  // Every id comes back as deleted, including ones that were already gone: a
  // patch someone else removed first is absent either way, and reporting that
  // as a failure would make an ordinary discard look broken.
  json(res, 200, {
    deleted: ids,
    // Per branch, as `home` answers, since a delete there can span branches.
    headVersions: Object.fromEntries(
      [...branches].map((branch) => [branch, chainVersion]),
    ),
  });
};

/**
 * `POST /v1/{project}/patches/{patchId}/files` — the bytes of an upload.
 *
 * Called by the browser directly in `http` mode (the Next server only proxies
 * this for AI-generated images), so this is the one write path that arrives
 * cross-origin with a nonce instead of the api key.
 */
const savePatchFile: Handler = async (req, res, url) => {
  const patchId = url.pathname.split("/").at(-2);
  const body = await readJsonBody<{
    filePath: string;
    data: string | null;
    type: "file" | "image";
    metadata: unknown;
    remote?: boolean;
  }>(req);
  if (!patchId || !body || typeof body.filePath !== "string") {
    json(res, 400, { message: "Invalid save-patch-file body" });
    return;
  }
  // The patch itself may not exist yet — the client uploads bytes first and saves
  // the patch afterwards — so this never touches the patch map.
  let files = state.patchFiles.get(patchId);
  if (!files) {
    files = new Map();
    state.patchFiles.set(patchId, files);
  }
  if (body.data === null) {
    /**
     * A null body is a DELETE on the same endpoint.
     *
     * That is the wire shape: `createValSystem`'s upload seam posts here with
     * `data: null` to forget a file, which is what a gallery removal does after
     * the patch that stops referencing it has landed. Storing null as if it were
     * bytes left a record whose `data` was not a string, and the first thing to
     * read it — the control plane's byte count — threw.
     */
    files.delete(body.filePath);
    json(res, 200, { patchId, filePath: body.filePath, deleted: true });
    return;
  }
  const decoded = decodeDataUrl(body.data);
  if (!decoded) {
    json(res, 400, {
      message: `'data' is not a base64 data URL: ${body.data.slice(0, 24)}…`,
    });
    return;
  }
  files.set(body.filePath, {
    bytes: decoded.bytes,
    mimeType: decoded.mimeType ?? "application/octet-stream",
    type: body.type,
    metadata: body.metadata,
    remote: body.remote === true,
    source: "upload",
  });
  json(res, 200, { patchId, filePath: body.filePath });
};

/**
 * `data:<mime>;base64,<payload>` to the bytes it carries.
 *
 * The upload endpoint takes a data URL because that is what `FileReader` gives
 * the browser; everything past this point works in bytes, which is what the
 * real service does too.
 */
function decodeDataUrl(
  dataUrl: string,
): { bytes: Buffer; mimeType: string | null } | null {
  if (!dataUrl.startsWith("data:")) {
    return null;
  }
  const marker = ";base64,";
  const at = dataUrl.indexOf(marker);
  if (at === -1) {
    return null;
  }
  return {
    bytes: Buffer.from(dataUrl.slice(at + marker.length), "base64"),
    mimeType: dataUrl.slice("data:".length, at) || null,
  };
}

/** `GET /v1/{project}/patches/{patchId}/files?file_path=&remote=` — metadata only. */
const getPatchFileMetadata: Handler = (req, res, url) => {
  const patchId = url.pathname.split("/").at(-2);
  const filePath = url.searchParams.get("file_path");
  if (!patchId || !filePath) {
    json(res, 400, { message: "file_path is required" });
    return;
  }
  const file = state.patchFiles.get(patchId)?.get(filePath);
  // Matched on `remote` as well as the path, because home matches on
  // `is_remote`: a file attached as remote is not found by a local lookup.
  // Ignoring it here once hid a broken AI gallery add (see aiChat.spec.ts).
  if (!file || file.remote !== (url.searchParams.get("remote") === "true")) {
    json(res, 404, { message: `No file ${filePath} in patch ${patchId}` });
    return;
  }
  json(res, 200, { filePath, metadata: file.metadata, type: file.type });
};

/**
 * `PUT /v1/{project}/files` — read files, from the repo or from a patch.
 *
 * PUT with a body because the request is a list of files; that is the real
 * protocol, oddity included. ONE encoding: plain base64, for a repo file and a
 * patch file alike. It used to be base64 here and a data URL there, so the
 * field's meaning depended on a branch the caller could not see.
 */
const getFiles: Handler = async (req, res) => {
  const body = await readJsonBody<{
    files: (
      | {
          filePath: string;
          location: "patch";
          patchId: string;
          remote: boolean;
        }
      | { filePath: string; location: "repo"; root: string; commitSha: string }
    )[];
    root: string;
  }>(req);
  if (!body || !Array.isArray(body.files)) {
    json(res, 400, { message: "Invalid files body" });
    return;
  }
  const files = [];
  const errors = [];
  for (const requested of body.files) {
    if (requested.location === "patch") {
      const file = state.patchFiles
        .get(requested.patchId)
        ?.get(requested.filePath);
      // Matched on `remote` too, as home does. See getPatchFileMetadata.
      if (!file || file.remote !== (requested.remote === true)) {
        errors.push({
          filePath: requested.filePath,
          location: "patch" as const,
          patchId: requested.patchId,
          remote: requested.remote,
          message: `No file ${requested.filePath} in patch ${requested.patchId}`,
        });
        continue;
      }
      files.push({
        filePath: requested.filePath,
        location: "patch" as const,
        patchId: requested.patchId,
        remote: requested.remote,
        // Plain base64, the same as the `repo` branch below.
        value: file.bytes.toString("base64"),
      });
      continue;
    }
    const read = await readRepoFile(
      requested.root ?? body.root ?? "",
      requested.filePath,
    );
    if ("error" in read) {
      errors.push({
        filePath: requested.filePath,
        location: "repo" as const,
        commitSha: requested.commitSha,
        message: read.error,
      });
      continue;
    }
    files.push({
      filePath: requested.filePath,
      location: "repo" as const,
      commitSha: requested.commitSha,
      value: read.value,
    });
  }
  json(res, 200, errors.length > 0 ? { files, errors } : { files });
};

/** What `POST /commit` is sent, and what a publish job's seal records from its prepare. */
type CommitBody = {
  patchedSourceFiles: Record<string, string | null>;
  patchedBinaryFilesDescriptors: Record<
    string,
    { patchId: string; remote?: boolean }
  >;
  appliedPatches: Record<string, string[]>;
  root: string;
  message: string;
  committer: string;
  /**
   * NOT SENT any more, and the reason is worth keeping here.
   *
   * The branch a project publishes to is a column on the project in `home`,
   * so the publisher no longer asserts one -- a build with no repository
   * bakes no branch, and a build that did could only ever disagree with the
   * project it is publishing to. `newBranch` survives because creating a
   * branch is the one case where the publisher names a line of work that
   * does not exist yet.
   */
  newBranch?: string;
  baseSha?: string;
  /**
   * Each changed `.val.ts` module's Source after this commit and the schema it
   * was written against — the DATA, not the file's text. Optional because an
   * older `@valbuild/server` does not send it, and such a commit is then one
   * the history reader reports per module as `source-unavailable` rather than
   * treating as an empty module.
   */
  modules?: Record<string, { source: unknown; schema: unknown }>;
};

/** `POST /v1/{project}/commit` — publish. What it records is `recordCommit`'s. */
const commit: Handler = async (req, res) => {
  const body = await readJsonBody<CommitBody>(req);
  if (!body) {
    json(res, 400, { message: "Invalid commit body" });
    return;
  }
  const recorded = recordCommit(body);
  if ("error" in recorded) {
    json(res, 400, { message: recorded.error });
    return;
  }
  json(res, 200, {
    updatedFiles: Object.keys(body.patchedSourceFiles ?? {}),
    commit: recorded.commitSha,
    branch: recorded.branch,
    ...(recorded.headVersion !== undefined
      ? { headVersion: recorded.headVersion }
      : {}),
  });
};

/**
 * The bytes a commit's binary descriptors name, or why one cannot be found.
 *
 * Read BEFORE anything is written, so a commit that names a missing file
 * records nothing -- this used to write the source overlay and then refuse,
 * leaving half a commit behind.
 *
 * A remote descriptor has to find bytes that were uploaded FLAGGED remote, and
 * a local one bytes that were not: `home` keys a patch file by its `remote`
 * flag (`dal.files.getContent(..., remote)`), so the other kind is simply not
 * found there. The mock took either, which is how a client that forgot the
 * flag would have published happily here and been refused in production.
 */
function binaryFilesOf(body: {
  patchedBinaryFilesDescriptors?: Record<
    string,
    { patchId: string; remote?: boolean }
  >;
}):
  | { files: { filePath: string; remote: boolean; base64: string }[] }
  | { error: string } {
  const files: { filePath: string; remote: boolean; base64: string }[] = [];
  for (const [filePath, descriptor] of Object.entries(
    body.patchedBinaryFilesDescriptors ?? {},
  )) {
    const remote = descriptor.remote === true;
    // A remote descriptor names the ref; the bytes were uploaded under the path
    // inside it. See `pathInRemoteRef`.
    const storedAs = pathInRemoteRef(filePath) ?? filePath;
    const file = state.patchFiles.get(descriptor.patchId)?.get(storedAs);
    if (!file || file.remote !== remote) {
      // Logged as well as returned: `ValOpsHttp.commit` runs its error body
      // through `getErrorMessageFromUnknownJson` after zod has already wrapped
      // it, so the caller only ever sees "Unknown error" and the reason has to
      // be found here.
      const message = `Commit references a file that was never uploaded${remote ? " as remote" : ""}: ${filePath} (looked for ${storedAs} in patch ${descriptor.patchId}). Uploaded for that patch: ${JSON.stringify([...(state.patchFiles.get(descriptor.patchId)?.entries() ?? [])].map(([uploaded, { remote }]) => (remote ? `${uploaded} (remote)` : uploaded)))}`;
      console.error(`[mock-content-host] ${message}`);
      return { error: message };
    }
    files.push({ filePath, remote, base64: file.bytes.toString("base64") });
  }
  return { files };
}

/**
 * Record a commit: what `POST /commit` does, and what a publish job's seal
 * does with what its prepare was sent.
 *
 * Four things happen, and the tests depend on all of them: the source text lands
 * in the overlay, uploaded binaries move from their patch into the repo (or into
 * remote storage), the patches involved are marked applied rather than deleted,
 * and a commit record appears — which is what turns into a row in the Studio's
 * deployment list on the next `/stat`.
 */
function recordCommit(
  body: CommitBody,
):
  | { commitSha: string; branch: string; headVersion?: number }
  | { error: string } {
  const binaries = binaryFilesOf(body);
  if ("error" in binaries) {
    return binaries;
  }
  // The line that keeps a proposal's changes off the site until a merge.
  const elsewhere = Object.values(body.appliedPatches ?? {})
    .flat()
    .filter(
      (patchId) =>
        (state.patches.get(patchId)?.branch ?? PROJECT_BRANCH) !==
        PROJECT_BRANCH,
    );
  if (elsewhere.length > 0) {
    return {
      error: `These changes are in a proposal, and reach the site by merging it: ${elsewhere.join(", ")}`,
    };
  }
  const parentCommitSha = state.headCommitSha;
  const commitSha = sha(
    `${parentCommitSha}:${JSON.stringify(body.patchedSourceFiles)}:${state.commits.length}`,
  ).slice(0, 40);

  for (const [filePath, content] of Object.entries(
    body.patchedSourceFiles ?? {},
  )) {
    state.repoOverlay.set(
      path.posix.join(body.root || "/", filePath),
      content === null ? null : { encoding: "utf8", value: content },
    );
  }
  for (const { filePath, remote, base64 } of binaries.files) {
    if (remote) {
      state.remoteFiles.set(filePath, base64);
    } else {
      state.repoOverlay.set(path.posix.join(body.root || "/", filePath), {
        encoding: "base64",
        value: base64,
      });
    }
  }
  const appliedPatchIds = new Set(
    Object.values(body.appliedPatches ?? {}).flat(),
  );
  for (const patchId of appliedPatchIds) {
    const patch = state.patches.get(patchId);
    if (patch) {
      patch.applied = { commitSha };
    }
  }
  // What `/stat` reports just changed (these are applied now), so the chain
  // moves a version, as `home` bumps it in the transaction that marks them.
  if (appliedPatchIds.size > 0) {
    chainVersion += 1;
  }
  /*
   * The archive and the snapshot: what history reads.
   *
   * `home` writes the archive AFTER the push and BEFORE the patch rows give up
   * their ops. The mock has no cold storage to move ops into, so the copy here
   * is the whole of that step — but it is still a COPY taken now, so a later
   * discard or reset of the chain cannot change what a commit is recorded as
   * having done.
   *
   * Patches are archived in chain order, which is `state.patches` iteration
   * order: the history reader replays them and any other order gives a
   * different source.
   */
  const modules = body.modules ?? {};
  const toGitPath = (filePath: string): string =>
    path.posix.join(body.root || "/", filePath).replace(/^\/+/, "");
  // Which modules existed before this commit, asked of the versions the earlier
  // commits recorded — the same question `home` asks its `val_module_versions`
  // index. Keyed by MODULE FILE PATH, which is how both sides name a module.
  const previouslyKnown = new Set(modulesAsOf(state.commits.length).keys());
  const affectedFiles: MockAffectedFile[] = [];
  for (const [filePath, content] of Object.entries(
    body.patchedSourceFiles ?? {},
  )) {
    const gitPath = toGitPath(filePath);
    affectedFiles.push({
      kind: classifyAffectedFile(gitPath),
      gitPath,
      // Deleted if the commit removed it, modified if an earlier commit recorded
      // a version of it, otherwise this commit created it.
      change:
        content === null
          ? "deleted"
          : previouslyKnown.has(filePath)
            ? "modified"
            : "added",
    });
  }
  for (const [filePath, descriptor] of Object.entries(
    body.patchedBinaryFilesDescriptors ?? {},
  )) {
    if (descriptor.remote) {
      affectedFiles.push({
        kind: "remote-binary",
        ref: filePath,
        change: "added",
      });
    } else {
      // Always "added", as in `home`: the archive genuinely does not know
      // whether the path existed before, and says so rather than guessing.
      affectedFiles.push({
        kind: "binary",
        gitPath: toGitPath(filePath),
        change: "added",
      });
    }
  }
  state.archives.set(commitSha, {
    commitSha,
    parentCommitSha,
    baseSha: body.baseSha ?? "",
    // This commit is about to be pushed onto `state.commits`, so its 1-based
    // position is the current length plus one.
    seqNum: state.commits.length + 1,
    patches: [...state.patches.values()]
      .filter((patch) => appliedPatchIds.has(patch.patchId))
      .map((patch) => ({ ...patch })),
    modules,
    affectedFiles,
  });
  state.snapshots.set(commitSha, new Map(state.repoOverlay));
  const record: MockCommit = {
    commitSha,
    clientCommitSha: commitSha,
    parentCommitSha,
    commitMessage: body.message ?? null,
    branch: body.newBranch || PROJECT_BRANCH,
    creator: body.committer,
    createdAt: nowIso(),
  };
  state.commits.push(record);
  state.headCommitSha = commitSha;
  broadcast({ type: "commit", commit: record });
  // The patches are still in the chain, now applied. Announced so a second
  // editor's Studio learns they were published rather than still pending.
  broadcastChain();
  return {
    commitSha,
    branch: record.branch,
    ...(appliedPatchIds.size > 0 ? { headVersion: chainVersion } : {}),
  };
}

/** `POST /v1/{project}/commit-summary` — the AI-written publish message. */
const commitSummary: Handler = (req, res) => {
  json(res, 200, { commitSummary: "Mock summary of the changes" });
};

// #region history

/**
 * The `/commits/*` routes, as `home` serves them.
 *
 * Every one of them is addressed by the sha Val CREATED — `MockCommit.commitSha`,
 * the value `POST /commit` answered with — and answers 404 for anything else,
 * because "not a commit Val made" is the answer the history reader turns into
 * `commit-not-found`, and a lenient mock here would hide a Studio that asked
 * for the wrong sha.
 */

/** The commit sha in `/commits/{sha}/...`, or null if the path is not one. */
function commitShaInPath(rest: string): string | null {
  const match = rest.match(
    /^\/commits\/([^/]+)\/(patches|modules|affected-files|file)$/,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function findCommit(commitSha: string): MockCommit | undefined {
  return state.commits.find((commit) => commit.commitSha === commitSha);
}

/**
 * `GET /v1/{project}/commits?branch=&limit=&cursor=`
 *
 * Newest first, a page at a time. The cursor is the `seqNum` of the last commit
 * on the previous page, exactly as `home` does it with `val_commits.seq_num`:
 * monotonic and unique, so a commit made while someone pages through cannot make
 * the listing skip or repeat one. Here `seqNum` is the commit's 1-based position
 * in `state.commits`.
 */
const listCommits: Handler = (req, res, url) => {
  const branch = url.searchParams.get("branch");
  if (!branch) {
    json(res, 400, { message: "Missing required query param: branch" });
    return;
  }
  const DEFAULT_LIMIT = 25;
  const MAX_LIMIT = 100;
  let limit = DEFAULT_LIMIT;
  const limitParam = url.searchParams.get("limit");
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      json(res, 400, {
        message: `Invalid limit: must be an integer between 1 and ${MAX_LIMIT}`,
      });
      return;
    }
    limit = parsed;
  }
  let cursor: number | null = null;
  const cursorParam = url.searchParams.get("cursor");
  if (cursorParam !== null) {
    const parsed = Number(cursorParam);
    if (!Number.isInteger(parsed)) {
      json(res, 400, {
        message: "Invalid cursor: expected the nextCursor of a previous page",
      });
      return;
    }
    cursor = parsed;
  }
  const rows = state.commits
    .map((commit, index) => ({ commit, seqNum: index + 1 }))
    .filter(({ commit }) => commit.branch === branch)
    .filter(({ seqNum }) => cursor === null || seqNum < cursor)
    .reverse();
  // One extra row tells "last page" apart from "the next page is empty",
  // without a count.
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  json(res, 200, {
    commits: page.map(({ commit, seqNum }) => ({
      commitSha: commit.commitSha,
      parentCommitSha: commit.parentCommitSha,
      clientCommitSha: commit.clientCommitSha,
      branch: commit.branch,
      createdBranch: null,
      creator: commit.creator,
      message: commit.commitMessage,
      createdAt: commit.createdAt,
      seqNum: String(seqNum),
      patchCount: [...state.patches.values()].filter(
        (patch) => patch.applied?.commitSha === commit.commitSha,
      ).length,
      hasArchive: state.archives.has(commit.commitSha),
    })),
    nextCursor: hasMore && last ? String(last.seqNum) : null,
  });
};

/**
 * `GET /v1/{project}/commits/{sha}/patches`
 *
 * The ops from the archive when there is one. For a commit without one — pushed
 * through the control plane, standing in for a commit from before archiving
 * shipped — `home` still answers from the rows, whose ops stayed inline; the
 * mock does the same from `state.patches`, which for such a commit is empty.
 */
const commitPatches: Handler = (req, res, url) => {
  const commitSha = commitShaInPath(
    url.pathname.slice(`/v1/${PROJECT}`.length),
  );
  const commit = commitSha ? findCommit(commitSha) : undefined;
  if (!commitSha || !commit) {
    json(res, 404, {
      message: `No commit ${commitSha} created by Val in this project`,
    });
    return;
  }
  const archive = state.archives.get(commitSha);
  const patches =
    archive?.patches ??
    [...state.patches.values()].filter(
      (patch) => patch.applied?.commitSha === commitSha,
    );
  json(res, 200, {
    commitSha,
    /*
     * The commit's own summary, alongside its ops.
     *
     * `home` returns it here because it already has the row. Val used to find
     * it by paging the LISTING until the sha turned up — twenty requests to
     * open an old commit, and one on another branch never found at all — so
     * this is now where the summary comes from, and the mock has to speak it or
     * every history read is a 500.
     */
    commit: {
      commitSha: commit.commitSha,
      parentCommitSha: commit.parentCommitSha,
      clientCommitSha: commit.clientCommitSha,
      branch: commit.branch,
      createdBranch: null,
      creator: commit.creator,
      message: commit.commitMessage,
      createdAt: commit.createdAt,
      seqNum: String(
        state.commits.findIndex((c) => c.commitSha === commitSha) + 1,
      ),
      hasArchive: state.archives.has(commitSha),
    },
    patches: patches.map((patch) => ({
      patchId: patch.patchId,
      path: patch.path,
      patch: patch.patch,
      authorId: patch.authorId,
      createdAt: patch.createdAt,
      baseSha: patch.baseSha,
      coreVersion: patch.coreVersion,
    })),
  });
};

/**
 * The hash `home` would file a Source or schema under: SHA-256 of the JSON as
 * written. Reported so a test can assert two commits share an unchanged schema
 * the way `home`'s content addressing makes them.
 */
function blobSha(value: unknown): string {
  return sha(JSON.stringify(value));
}

type ModuleVersion = {
  moduleFilePath: string;
  commitSha: string;
  source: unknown;
  schema: unknown;
};

/**
 * Every module's state as of the commit at 1-based position `seqNum` — the
 * latest recorded version of each module, at or before that commit.
 *
 * This is `home`'s `val_module_versions` lookup, done as a walk over the
 * archives rather than an index because a test makes a handful of commits. The
 * walk is in commit order, so the last write for a module wins.
 */
function modulesAsOf(seqNum: number): Map<string, ModuleVersion> {
  const versions = new Map<string, ModuleVersion>();
  state.commits.slice(0, seqNum).forEach((commit) => {
    const archive = state.archives.get(commit.commitSha);
    if (!archive) return;
    for (const [moduleFilePath, module] of Object.entries(archive.modules)) {
      versions.set(moduleFilePath, {
        moduleFilePath,
        commitSha: commit.commitSha,
        source: module.source,
        schema: module.schema,
      });
    }
  });
  return versions;
}

/**
 * `GET /v1/{project}/commits/{sha}/modules?as_of=1&path=`
 *
 * Each module the commit changed: its data and the schema it was written under,
 * both handed back opaquely — `home` never reads a schema, and neither does the
 * mock; deciding whether this Val can read it is the reader's job.
 *
 * `as_of=1` widens the answer from "what this commit changed" to "every module
 * as this commit left the project", which is what a whole-project revert and
 * navigating the history pane off the changed set need. `path=` narrows to one
 * module. Same shape either way.
 *
 * A commit with no archive answers an empty list, as `home` does for a commit
 * made before archiving shipped: the Val side reports that per module as
 * `source-unavailable`, not as "the module was empty".
 */
const commitModules: Handler = (req, res, url) => {
  const commitSha = commitShaInPath(
    url.pathname.slice(`/v1/${PROJECT}`.length),
  );
  const commit = commitSha ? findCommit(commitSha) : undefined;
  if (!commitSha || !commit) {
    json(res, 404, {
      message: `No commit ${commitSha} created by Val in this project`,
    });
    return;
  }
  const seqNum = state.commits.indexOf(commit) + 1;
  const asOf = url.searchParams.get("as_of") === "1";
  const wantedPath = url.searchParams.get("path");
  let versions: ModuleVersion[];
  if (asOf) {
    versions = [...modulesAsOf(seqNum).values()];
  } else {
    const archive = state.archives.get(commitSha);
    versions = archive
      ? Object.entries(archive.modules).map(([moduleFilePath, module]) => ({
          moduleFilePath,
          commitSha,
          source: module.source,
          schema: module.schema,
        }))
      : [];
  }
  json(res, 200, {
    commitSha,
    parentCommitSha: commit.parentCommitSha,
    modules: versions
      .filter(
        (version) =>
          wantedPath === null || version.moduleFilePath === wantedPath,
      )
      .map((version) => ({
        moduleFilePath: version.moduleFilePath,
        commitSha: version.commitSha,
        sourceSha: version.source === null ? null : blobSha(version.source),
        schemaSha: blobSha(version.schema),
        source: version.source,
        schema: version.schema,
        // The mock holds the values themselves, so it can never hold a hash
        // without the object. `home` can, and reports it here.
        unavailable: false,
      })),
  });
};

/** `GET /v1/{project}/commits/{sha}/affected-files` — names, not bytes. */
const commitAffectedFiles: Handler = (req, res, url) => {
  const commitSha = commitShaInPath(
    url.pathname.slice(`/v1/${PROJECT}`.length),
  );
  const commit = commitSha ? findCommit(commitSha) : undefined;
  if (!commitSha || !commit) {
    json(res, 404, {
      message: `No commit ${commitSha} created by Val in this project`,
    });
    return;
  }
  json(res, 200, {
    commitSha,
    files: state.archives.get(commitSha)?.affectedFiles ?? [],
  });
};

/**
 * `GET /v1/{project}/commits/{sha}/file?path=&remote=`
 *
 * One file's bytes as they were at that commit. Bytes rather than JSON so an
 * `<img src>` can point straight at the app route that proxies this, and
 * immutable for the same reason `home` marks it so: a file at a fixed commit
 * cannot change.
 *
 * A remote file is content-addressed and lives outside git, so the commit is
 * not part of finding it — the ref is, and the mock holds it under the ref the
 * commit named.
 */
const commitFile: Handler = async (req, res, url) => {
  const commitSha = commitShaInPath(
    url.pathname.slice(`/v1/${PROJECT}`.length),
  );
  const commit = commitSha ? findCommit(commitSha) : undefined;
  const initialCommit =
    process.env.MOCK_CONTENT_INITIAL_COMMIT ?? "mockcommit0";
  if (!commitSha || (!commit && commitSha !== initialCommit)) {
    json(res, 404, {
      message: `No commit ${commitSha} created by Val in this project`,
    });
    return;
  }
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    json(res, 400, { message: "Missing required query param: path" });
    return;
  }
  let bytes: Buffer;
  if (url.searchParams.get("remote") === "true") {
    const stored = state.remoteFiles.get(filePath);
    if (stored === undefined) {
      json(res, 404, { message: `No remote file for ref ${filePath}` });
      return;
    }
    bytes = Buffer.from(stored, "base64");
  } else {
    const read = await readFileAtCommit(commitSha, filePath);
    if ("error" in read) {
      json(res, read.status, { message: read.error });
      return;
    }
    bytes = read.bytes;
  }
  res.writeHead(200, {
    "Content-Type": mimeTypeOf(filePath),
    "Content-Length": bytes.byteLength,
    "Cache-Control": "private, max-age=31536000, immutable",
    ...corsHeaders(res),
  });
  res.end(bytes);
};

// #endregion history

/**
 * `POST /v1/{project}/presigned-auth-nonce`
 *
 * What lets the browser upload without ever holding the api key. The nonce it
 * hands back is the credential `savePatchFile` accepts.
 */
const presignedAuthNonce: Handler = (req, res) => {
  const nonce = randomUUID();
  state.nonces.add(nonce);
  json(res, 200, {
    nonce,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
};

/**
 * `POST /v1/{project}/websocket/nonces`
 *
 * The reply decides where the browser opens its socket, so the url has to be one
 * the browser can reach — this host, not an internal name.
 */
const websocketNonce: Handler = async (req, res) => {
  /*
   * `relativeTo: "live"` (a previous build's `/stat` answered at the live
   * build) is accepted and changes nothing here: this mock's socket sends
   * every branch's WHOLE chain, at no position, so there is no other chain to
   * file it under. `home` files it under the live build's.
   */
  const body = await readJsonBody<{ branch?: string; relativeTo?: "live" }>(
    req,
  );
  const nonce = randomUUID();
  state.nonces.add(nonce);
  // A nonce is for one branch's chain: a proposal's Studio names its branch.
  socketBranchOfNonce.set(nonce, body?.branch ?? PROJECT_BRANCH);
  json(res, 200, { nonce, url: `ws://localhost:${PORT}/ws` });
};

/** `GET /v1/{project}/settings` — where remote files are allowed to live. */
const settings: Handler = (req, res) => {
  json(res, 200, {
    publicProjectId: PUBLIC_PROJECT_ID,
    remoteFileBuckets: [{ bucket: "mock-bucket" }],
  });
};

/** `GET /v1/{project}/profiles` — who the Studio shows next to a change. */
const profiles: Handler = (req, res) => {
  json(res, 200, { profiles: PROFILES });
};

/**
 * `PUT /v1/{project}/remote/files/b/{bucket}/f/{hash}.{ext}`
 *
 * Only `fs` mode uploads this way (the content service does it itself at commit
 * time in `http` mode), but it is here so a mixed-mode run does not 404.
 */
const putRemoteFile: Handler = async (req, res, url) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  state.remoteFiles.set(url.pathname, Buffer.concat(chunks).toString("base64"));
  json(res, 200, { success: true });
};

// #endregion

// #region ai

/**
 * `POST /v1/{project}/ai/initialize`
 *
 * The Studio's server proxies this and turns the nonce into a socket url of its
 * own — `{contentUrl}/v1/{project}/ai/connect` with the scheme swapped — so all
 * this has to do is hand out a nonce the socket will accept.
 */
const aiInitialize: Handler = (req, res) => {
  if (state.aiOffline) {
    json(res, 500, { message: "The assistant is having a bad day" });
    return;
  }
  const nonce = randomUUID();
  state.nonces.add(nonce);
  json(res, 200, { nonce });
};

/** `GET /v1/{project}/ai/sessions` — what the chat's session picker lists. */
const aiSessions: Handler = (req, res) => {
  json(res, 200, {
    sessions: [...state.aiSessions.values()].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1,
    ),
    nextCursor: null,
  });
};

/** `PATCH /v1/{project}/ai/sessions/{id}` — what `set_session_name` ends up as. */
const aiRenameSession: Handler = async (req, res, url) => {
  const sessionId = url.pathname.split("/").at(-1) ?? "";
  const body = await readJsonBody<{ name?: string }>(req);
  const session = state.aiSessions.get(sessionId);
  if (session) {
    session.name = body?.name ?? null;
    session.updatedAt = nowIso();
  } else {
    state.aiSessions.set(sessionId, {
      id: sessionId,
      name: body?.name ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
    });
  }
  json(res, 200, {});
};

/**
 * `GET /v1/{project}/ai/sessions/{id}/messages`
 *
 * The conversation, as the service would replay it. The Studio asks whenever a
 * session id is restored — from the URL on load, and every time the assistant
 * panel is reopened, since closing it unmounts the chat.
 */
const aiSessionMessages: Handler = (req, res, url) => {
  const sessionId = url.pathname.split("/").at(-2) ?? "";
  json(res, 200, {
    messages: state.aiSessions.get(sessionId)?.messages ?? [],
    nextCursor: null,
  });
};

/**
 * `POST /v1/{project}/ai/images?sessionid=&width=&height=&mimetype=`
 *
 * The one AI route the BROWSER calls directly, with the presigned nonce rather
 * than the api key — the bytes of a file the editor attached in the chat. The
 * reply is the opaque key that is all the model is ever told about the image.
 */
const aiUploadImage: Handler = async (req, res, url) => {
  const data = await readRawBody(req);
  const sessionId = decodeURIComponent(url.searchParams.get("sessionid") ?? "");
  const key = randomUUID();
  state.aiImages.set(key, {
    key,
    sessionId,
    data,
    mimeType: decodeURIComponent(
      url.searchParams.get("mimetype") ??
        (req.headers["content-type"] as string | undefined) ??
        "application/octet-stream",
    ),
    width: Number(decodeURIComponent(url.searchParams.get("width") ?? "0")),
    height: Number(decodeURIComponent(url.searchParams.get("height") ?? "0")),
  });
  json(res, 200, { key });
};

/** `GET /v1/{project}/ai/images?key=` — the bytes back, as `fs` mode fetches them. */
const aiDownloadImage: Handler = (req, res, url) => {
  const image = state.aiImages.get(url.searchParams.get("key") ?? "");
  if (!image) {
    json(res, 404, { message: "No such session image" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": image.mimeType,
    "Content-Length": image.data.byteLength,
    ...corsHeaders(res),
  });
  res.end(image.data);
};

/**
 * `POST /v1/{project}/patches/{patchId}/files/from-session-file`
 *
 * The hinge of the whole image flow: a key the model named becomes bytes
 * attached to a patch. In production the service copies them internally, which
 * is why the browser never re-uploads and why the Studio only learns the
 * dimensions here — so the mock does the same copy, into the same `patchFiles`
 * map an ordinary upload lands in.
 *
 * An unknown key is a 400 carrying `availableKeys`, not a 500: that is the shape
 * the Studio turns into "retry with one of these", and a model naming a
 * vision-system file id instead of the key is the mistake it exists for.
 */
const aiSessionFileToPatchFile: Handler = async (req, res, url) => {
  const patchId = url.pathname.split("/").at(-3);
  const body = await readJsonBody<{
    files: { filePath: string; key: string; isRemote?: boolean }[];
  }>(req);
  if (!patchId || !body || !Array.isArray(body.files)) {
    json(res, 400, { message: "Invalid from-session-file body" });
    return;
  }
  const resolved: { filePath: string; metadata: unknown; sha256?: string }[] =
    [];
  for (const requested of body.files) {
    const image = state.aiImages.get(requested.key);
    if (!image) {
      json(res, 400, {
        message: `No session file with key '${requested.key}'`,
        details: { availableKeys: [...state.aiImages.keys()] },
      });
      return;
    }
    let files = state.patchFiles.get(patchId);
    if (!files) {
      files = new Map();
      state.patchFiles.set(patchId, files);
    }
    files.set(requested.filePath, {
      // The SAME bytes the session file holds. In production this is now a
      // pointer at the object the session file already has rather than a copy
      // of it, which it could not be while the two were stored differently.
      bytes: image.data,
      mimeType: image.mimeType,
      type: image.mimeType.startsWith("image/") ? "image" : "file",
      metadata: {
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
      },
      remote: requested.isRemote === true,
      source: "session-file",
    });
    resolved.push({
      filePath: requested.filePath,
      metadata: {
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
      },
      // What a remote file's ref names, so the Studio need not download the
      // image to hash it.
      ...(state.aiSessionSha256
        ? { sha256: createHash("sha256").update(image.data).digest("hex") }
        : {}),
    });
  }
  json(res, 200, { patchId, files: resolved });
};

/**
 * The assistant sockets, and the result each tool call is waiting for.
 *
 * One map for the whole process rather than per socket: a tool result arrives on
 * the same socket that asked, but the waiter is created inside the script player
 * and resolved from the socket's message handler, and threading it through would
 * mean the player owning the socket's listeners.
 */
const pendingToolResults = new Map<
  string,
  (res: { result: unknown; isError: boolean }) => void
>();

/** The image keys the Studio attached to a prompt, in the order it sent them. */
function imageKeysOf(message: unknown): string[] {
  if (!Array.isArray(message)) return [];
  const keys: string[] = [];
  for (const block of message) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "image_key" &&
      typeof (block as { key?: unknown }).key === "string"
    ) {
      keys.push((block as { key: string }).key);
    }
  }
  return keys;
}

function promptTextOf(message: unknown): string {
  if (typeof message === "string") return message;
  if (!Array.isArray(message)) return "";
  return message
    .filter(
      (block): block is { type: "text"; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * Fill `{{imageKey:N}}` in a scripted tool call with a key from this prompt.
 *
 * A test cannot write the key literally — the content service invents it at
 * upload time — and having the test read it back and then send the script would
 * make every image test a two-phase dance. So the script names the Nth image the
 * user attached and the mock resolves it, exactly as a model would after reading
 * the `[Attached images]` list.
 */
function substituteImageKeys(args: unknown, imageKeys: string[]): unknown {
  if (args === undefined) return args;
  const filled = JSON.stringify(args).replace(
    /\{\{imageKey:(\d+)\}\}/g,
    (whole, index: string) => imageKeys[Number(index)] ?? whole,
  );
  return JSON.parse(filled);
}

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/** Play one scripted turn over the assistant socket. */
async function playAiTurn(
  socket: WebSocket,
  prompt: {
    id?: string;
    sessionId?: string;
    message?: unknown;
    reportUsage?: boolean;
  },
): Promise<void> {
  /**
   * Every server -> client message echoes the id the client put on its prompt.
   *
   * That is what the real service does (`aiHandler.ts` passes `message.id`
   * straight through to `ai_streaming`, `ai_tool_call`, `ai_response`,
   * `ai_cancelled` and `ai_error`), and the Studio relies on it: one socket
   * carries every session, so the id is how a listener tells its own turn from
   * somebody else's. Minting a fresh one here made the mock the only "server"
   * that answered a prompt under an id nobody asked about.
   */
  const messageId = prompt.id ?? randomUUID();
  const sessionId = prompt.sessionId ?? randomUUID();
  const imageKeys = imageKeysOf(prompt.message);
  state.aiPrompts.push({
    sessionId: prompt.sessionId ?? null,
    text: promptTextOf(prompt.message),
    imageKeys,
  });
  let session = state.aiSessions.get(sessionId);
  if (session) {
    session.updatedAt = nowIso();
  } else {
    session = {
      id: sessionId,
      name: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
    };
    state.aiSessions.set(sessionId, session);
  }
  session.messages.push({
    role: "user",
    content: promptTextOf(prompt.message),
  });
  const send = (message: unknown): void => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };
  const script = state.aiScripts.shift() ?? {
    steps: [],
    response: "No script was queued for this turn.",
  };
  for (const step of script.steps) {
    if (step.type === "text") {
      send({ type: "ai_streaming", id: messageId, chunk: step.text });
      continue;
    }
    if (step.type === "usage") {
      if (prompt.reportUsage) {
        send({
          type: "ai_usage",
          id: messageId,
          outputTokens: step.outputTokens,
          estimated: step.estimated ?? false,
        });
      }
      continue;
    }
    const toolCallId = randomUUID();
    const args = substituteImageKeys(step.arguments ?? {}, imageKeys);
    const answered = new Promise<{ result: unknown; isError: boolean }>(
      (resolve) => {
        pendingToolResults.set(toolCallId, resolve);
        const timeoutMs =
          step.timeoutMs === undefined
            ? DEFAULT_TOOL_TIMEOUT_MS
            : step.timeoutMs;
        if (timeoutMs !== null) {
          setTimeout(() => {
            if (pendingToolResults.delete(toolCallId)) {
              resolve({
                result: { error: `Timed out waiting for ${step.name}` },
                isError: true,
              });
            }
          }, timeoutMs).unref();
        }
      },
    );
    send({
      type: "ai_tool_call",
      id: messageId,
      toolCallId,
      name: step.name,
      arguments: args,
    });
    const answer = await answered;
    state.aiToolCalls.push({
      name: step.name,
      arguments: args,
      result: answer.result,
      isError: answer.isError,
    });
  }
  /**
   * Stream the reply, then close the turn — in that order, as the real service
   * does.
   *
   * `ai_response` alone would not put the text on screen: the Studio appends the
   * response body only when nothing has streamed under that message id yet, and a
   * turn that called a tool has already claimed the id. So a reply sent only as
   * `ai_response` renders as an empty assistant message, which is not what an
   * editor would ever see.
   */
  const response = script.response ?? "Done.";
  session.messages.push({ role: "assistant", content: response });
  send({ type: "ai_streaming", id: messageId, chunk: response });
  send({
    type: "ai_response",
    id: messageId,
    sessionId,
    response,
    ...(script.outputTokens !== undefined
      ? { metadata: { outputTokens: script.outputTokens } }
      : {}),
  });
}

// #endregion

// #region publish jobs

/**
 * Publishing as a queued job (valbuild/home, docs/app-mode.md, "Publishing is
 * a queued job"), as a CONNECTED project whose build is CI's.
 *
 * ```
 * POST /v1/{project}/publish-token   the api key, traded for a publish token
 * POST /v1/publish-requests          a press: the request, and its job
 * GET  /v1/publish-requests/{id}     where it is
 * POST /v1/publish-jobs/next         a free tab asks for queued work
 * POST /v1/publish-jobs/{id}/prepare the job's sources, from the Val server
 * POST /v1/publish-jobs/{id}/steps   the tab's reports
 * ```
 *
 * The publish API is not under `/v1/{project}`: a publish token names the
 * project, so the routes do not. Only the exchange is, with the api key.
 *
 * Why only connected, and with no build: a managed job needs a deployment that
 * embeds its source (`/publish-job-prepare` refuses one that does not), and
 * `examples/next` is not that. The managed path, tab build and all, is driven
 * by valbuild/home's `pnpm loop`. What this exercises is the Val server's half
 * -- what `/publish-job-prepare` computes and sends -- and the Studio's press,
 * track and Live.
 *
 * So the prepare is where this differs from `/commit`, as content's does: it
 * puts the job's REMOTE files in remote storage before anything is recorded
 * (`uploadPatchRemoteFiles` in home), and a file it cannot find fails the job
 * there. Without `tabBuilds` content then seals at once, and so does this.
 *
 * Simplified where nothing here could tell: a failed step fails the job at
 * once rather than after content's three attempts, and a job takes every
 * pending patch rather than content's forward closure.
 */

function publishTokenOf(req: IncomingMessage): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  return state.publishTokens.has(token) ? token : null;
}

/**
 * `GET /v1/project-source`, with a publish token: the live build's files, BY
 * VERSION. A strong `ETag` -- the sha256 of the answer, as `home` sends it --
 * and a 304 with no body to a matching `If-None-Match` (`*`, a list, `W/`
 * ignored), so the Studio's code tools can ask on every call.
 */
function projectSource(req: IncomingMessage, res: ServerResponse): void {
  const body = {
    files: state.projectSource,
    publicFiles: null,
    publicPaths: null,
  };
  const etag = `"${sha(JSON.stringify(body))}"`;
  const held = req.headers["if-none-match"];
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  const matches =
    typeof held === "string" &&
    held
      .split(",")
      .some((tag) => tag.trim() === "*" || opaque(tag) === opaque(etag));
  const headers = {
    ETag: etag,
    "Cache-Control": "no-cache",
    ...corsHeaders(res),
  };
  if (matches) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    ...headers,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** `POST /v1/{project}/publish-token`, with the api key. */
const publishToken: Handler = (req, res) => {
  const token = `mock-publish-${randomUUID()}`;
  state.publishTokens.add(token);
  json(res, 200, {
    token,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    publicProjectId: PUBLIC_PROJECT_ID,
    productionUrl: null,
  });
};

function tabJobOf(job: MockPublishJob) {
  return { id: job.id, step: job.step, base: job.base, patches: job.patches };
}

/** Tell every Studio a job moved. A nudge: they re-read their requests. */
function nudgeJob(job: MockPublishJob): void {
  broadcast({
    type: "publish-job",
    job: { id: job.id, status: job.done ?? "running" },
  });
}

/** Every patch not yet applied, and not held by a job in flight. */
function pendingForJob(): string[] {
  const held = new Set<string>();
  for (const job of state.publishJobs.values()) {
    if (job.done === null) job.patches.forEach((id) => held.add(id));
  }
  return patchesOn(PROJECT_BRANCH)
    .filter((patch) => !patch.applied && !held.has(patch.patchId))
    .map((patch) => patch.patchId);
}

function jobInFlight(): MockPublishJob | null {
  for (const job of state.publishJobs.values()) {
    if (job.done === null) return job;
  }
  return null;
}

/**
 * Start a job for every queued request, if none is in flight, held by `tab`.
 * Answers the job, or null when there is none to start.
 */
function startJob(tab: string): MockPublishJob | null {
  if (jobInFlight() !== null) return null;
  const queued = [...state.publishRequests.values()].filter(
    (request) => request.status.kind === "queued",
  );
  if (queued.length === 0) return null;
  const patches = pendingForJob();
  if (patches.length === 0) {
    for (const request of queued) {
      request.status = { kind: "nothing-to-publish" };
    }
    return null;
  }
  const job: MockPublishJob = {
    id: `job-${randomUUID()}`,
    tab,
    step: "prepare",
    base: state.headCommitSha,
    patches,
    requestIds: queued.map((request) => request.requestId),
    prepared: null,
    done: null,
  };
  state.publishJobs.set(job.id, job);
  for (const request of queued) {
    request.status = { kind: "publishing" };
    request.jobId = job.id;
  }
  nudgeJob(job);
  return job;
}

function failJob(job: MockPublishJob, message: string): void {
  job.step = null;
  job.done = "failed";
  for (const requestId of job.requestIds) {
    const request = state.publishRequests.get(requestId);
    if (request) {
      request.status = {
        kind: "failed",
        message,
        actions: ["try-again", "discard"],
        job: job.id,
      };
    }
  }
  nudgeJob(job);
}

/** The seal: the prepared sources recorded as a commit, and every press Live. */
function sealJob(job: MockPublishJob): { error: string } | null {
  if (job.prepared === null) return { error: "The job was never prepared." };
  const recorded = recordCommit({
    ...job.prepared,
    message: `Publish job ${job.id}`,
    committer: "publish-job",
    appliedPatches: { [job.id]: job.patches },
  });
  if ("error" in recorded) return recorded;
  job.step = null;
  job.done = "sealed";
  for (const requestId of job.requestIds) {
    const request = state.publishRequests.get(requestId);
    if (request) {
      request.status = { kind: "live", commit: recorded.commitSha };
    }
  }
  nudgeJob(job);
  return null;
}

/** The job a tab reports on, or the answer that it is not this tab's. */
function heldJob(
  res: ServerResponse,
  jobId: string,
  tab: string | undefined,
): MockPublishJob | null {
  const job = state.publishJobs.get(jobId);
  if (!job || job.done !== null || job.tab !== tab) {
    json(res, 200, { job: null });
    return null;
  }
  return job;
}

async function publishApi(
  req: IncomingMessage,
  res: ServerResponse,
  rest: string,
): Promise<void> {
  if (publishTokenOf(req) === null) {
    json(res, 401, { message: "Not a publish token" });
    return;
  }
  const route = `${req.method} ${rest}`;
  if (route === "GET /project-source") {
    projectSource(req, res);
    return;
  }
  if (
    route === "POST /publish-requests" ||
    route === "POST /publish-requests/try-again"
  ) {
    const body = await readJsonBody<{ requestId?: string; tab?: string }>(req);
    if (!body?.requestId || !body.tab) {
      json(res, 400, { message: "requestId and tab are required" });
      return;
    }
    // Idempotent on the request id, as content's press is.
    const existing = state.publishRequests.get(body.requestId);
    if (existing) {
      const job = existing.jobId ? state.publishJobs.get(existing.jobId) : null;
      json(res, 200, {
        request: existing.status,
        job:
          job && job.done === null && job.tab === body.tab
            ? tabJobOf(job)
            : null,
      });
      return;
    }
    const request: MockPublishRequest = {
      requestId: body.requestId,
      status: { kind: "queued" },
      jobId: null,
    };
    state.publishRequests.set(request.requestId, request);
    const job = startJob(body.tab);
    json(res, 200, {
      request: request.status,
      job:
        job && job.requestIds.includes(request.requestId)
          ? tabJobOf(job)
          : null,
    });
    return;
  }
  const requestMatch = rest.match(/^\/publish-requests\/([A-Za-z0-9_-]+)$/);
  if (req.method === "GET" && requestMatch) {
    const request = state.publishRequests.get(requestMatch[1]);
    if (!request) {
      json(res, 404, { message: "No such request" });
      return;
    }
    json(res, 200, { request: request.status });
    return;
  }
  if (route === "POST /publish-jobs/next") {
    const body = await readJsonBody<{ tab?: string }>(req);
    const job = body?.tab ? startJob(body.tab) : null;
    json(res, 200, { job: job ? tabJobOf(job) : null });
    return;
  }
  if (route === "GET /ci-runs/newest") {
    json(res, 200, { run: null });
    return;
  }
  const jobMatch = rest.match(
    /^\/publish-jobs\/([A-Za-z0-9_-]+)\/(prepare|steps|renew|cancel|discard)$/,
  );
  if (req.method !== "POST" || !jobMatch) {
    json(res, 404, { message: `Unhandled publish API route: ${route}` });
    return;
  }
  const [, jobId, action] = jobMatch;
  if (action === "prepare") {
    const body = await readJsonBody<
      Pick<
        CommitBody,
        | "patchedSourceFiles"
        | "patchedBinaryFilesDescriptors"
        | "root"
        | "modules"
      > & { tab?: string; tabBuilds?: true }
    >(req);
    const job = heldJob(res, jobId, body?.tab);
    if (!job || !body) return;
    if (job.step !== "prepare") {
      json(res, 200, { job: tabJobOf(job) });
      return;
    }
    /*
     * The remote files first, before anything is recorded, as content's
     * prepare does: a ref whose bytes were never uploaded remote fails the
     * job HERE, with the 502 the tab reads as "content has counted it".
     */
    const binaries = binaryFilesOf(body);
    if ("error" in binaries) {
      failJob(job, binaries.error);
      json(res, 502, { message: binaries.error });
      return;
    }
    for (const file of binaries.files) {
      if (file.remote) state.remoteFiles.set(file.filePath, file.base64);
    }
    job.prepared = {
      patchedSourceFiles: body.patchedSourceFiles,
      patchedBinaryFilesDescriptors: body.patchedBinaryFilesDescriptors,
      root: body.root,
      modules: body.modules,
      appliedPatches: {},
      message: "",
      committer: "",
    };
    if (body.tabBuilds === true) {
      job.step = "build";
      json(res, 200, { job: tabJobOf(job) });
      return;
    }
    // CI builds the push: content's from here, and sealed now.
    const sealed = sealJob(job);
    if (sealed !== null) {
      failJob(job, sealed.error);
      json(res, 502, { message: sealed.error });
      return;
    }
    json(res, 200, { job: tabJobOf(job) });
    return;
  }
  if (action === "steps") {
    const body = await readJsonBody<{
      tab?: string;
      step?: "prepare" | "build" | "upload";
      ok?: boolean;
      noBuild?: true;
      message?: string;
    }>(req);
    const job = heldJob(res, jobId, body?.tab);
    if (!job || !body) return;
    if (body.ok !== true) {
      failJob(job, body.message ?? `The ${body.step} step failed.`);
      json(res, 200, { job: null });
      return;
    }
    if (
      body.step === "build" &&
      job.step === "build" &&
      body.noBuild !== true
    ) {
      job.step = "upload";
    } else if (
      (body.step === "build" && body.noBuild === true) ||
      (body.step === "upload" && job.step === "upload")
    ) {
      const sealed = sealJob(job);
      if (sealed !== null) failJob(job, sealed.error);
    }
    json(res, 200, { job: tabJobOf(job) });
    return;
  }
  if (action === "renew") {
    const body = await readJsonBody<{ tab?: string }>(req);
    const job = state.publishJobs.get(jobId);
    json(res, 200, {
      renewed: !!job && job.done === null && job.tab === body?.tab,
    });
    return;
  }
  if (action === "cancel") {
    const job = state.publishJobs.get(jobId);
    const cancelled = !!job && job.done === null;
    if (job && cancelled) {
      job.step = null;
      job.done = "cancelled";
      for (const requestId of job.requestIds) {
        const request = state.publishRequests.get(requestId);
        if (request) request.status = { kind: "cancelled" };
      }
      nudgeJob(job);
    }
    json(res, 200, { cancelled });
    return;
  }
  // discard: the failed job's changes, gone from the chain.
  const job = state.publishJobs.get(jobId);
  if (job && job.done === "failed") {
    for (const patchId of job.patches) state.patches.delete(patchId);
    chainVersion += 1;
    broadcastChain();
  }
  json(res, 200, { stillHeld: [] });
}

// #endregion

// #region control plane

/**
 * `/__test__/*` — the events no editor action can produce.
 *
 * Deployments and pushed commits come from CI in production. A test that wants
 * to see the Studio react to one has to be able to say so, and this is where it
 * says it. Everything here also pushes down the WebSocket, because that is how a
 * running Studio finds out.
 */
// #region proposals

/**
 * A proposal, as `home` keeps one (`docs/proposals.md`): an editor-managed
 * branch of the project's content, `val/p/<name>`, with a chain of patches
 * of its own, saves that are commits on that branch, staged code, and the
 * saved state the platform serves its address from.
 *
 * What the mock does NOT do, and `scenarios/README.md` lists: no builds (a
 * staging is recorded, never built, so `buildRequired` stays true until a
 * build made elsewhere is handed in with `POST /build`), no render check, no
 * repository (Commit is recorded, not pushed; somebody's push is the control
 * plane's, and taking it in reads the files it was handed), no moves of the
 * site's changes at a merge, and a merge sealed at the press -- no publish
 * job, no tab, no merge-prepare.
 */
type MockProposal = {
  name: string;
  branch: string;
  displayName: string;
  description: string | null;
  ownerId: string | null;
  status: "open" | "merged" | "closed";
  createdAt: string;
  updatedAt: string;
  /** The create's id: the same create sent again answers this proposal. */
  requestId: string;
  /** The site's head when it was opened. */
  base: string;
  /**
   * What its saves and stagings left, as `readProposalSaved` reads it in
   * `home`: the last commit on the branch, each module's Source as of it,
   * and every file written (`null`: deleted). The overlay the platform
   * serves the address from is made of exactly this
   * (`val/proposalOverlay.ts`), so the mock keeps it current on every write
   * rather than running an overlay job.
   */
  saved: {
    commit: string | null;
    modules: Record<string, unknown>;
    files: Record<string, string | null>;
  };
  /** The commits on its branch, oldest first: its saves and stagings. */
  commits: string[];
  /** Paths staged as code, in the order first staged. */
  staged: string[];
  /**
   * Code mode (the code-mode contract, valbuild/home): the proposal's, for
   * everyone in it. Content only stores the flag: the save before turning it
   * on, and before each code write, is Val's server's.
   */
  codeMode: { on: boolean; changedBy: string | null; changedAt: string | null };
  /** What `GET /proposals/:name` lists in `events`: code mode and commits. */
  events: MockProposalEvent[];
  /**
   * Its git branch, `val/p/<name>`, in a connected project. Saves and
   * stagings do not push: only Commit and Publish do.
   */
  git: {
    /** The last Commit Val made; `null` before the first. */
    committed: {
      sha: string;
      url: string;
      save: string | null;
      by: string | null;
      at: string | null;
    } | null;
    /**
     * Somebody else's push to the branch, which Val has not seen: set by the
     * control plane (`/__test__/proposals/:name/push`), and why Commit is
     * refused (`someone-pushed`) until a test clears it.
     */
    theirs: {
      sha: string;
      url: string;
      message: string | null;
      author: {
        name: string | null;
        email: string | null;
        login: string | null;
        avatarUrl: string | null;
      } | null;
      at: string | null;
      /**
       * What their push changed, as project paths (`null`: deleted): what
       * taking it in stages. Kept here, never sent: home reads it from
       * GitHub's compare of `expected` and their tip.
       */
      files: Record<string, string | null>;
    } | null;
    /**
     * The last push of somebody else's that was taken in, and the lists its
     * answer gave (`already` answers them again). `building` until a build of
     * what the proposal holds is served.
     */
    takenIn: {
      sha: string;
      url: string;
      by: string | null;
      at: string | null;
      building: boolean;
      answer: TakePushLists;
      /**
       * The text each file had when it was taken in: a file still holding it
       * was not changed by the proposal, so their next push takes it again
       * rather than keeping it (contract v2, 3).
       */
      files: Record<string, string | null>;
    } | null;
  };
  /** The build its address serves, once one is (`POST /build`). */
  built: { hash: string; inputs: string } | null;
};

/** What a take-in lists: home's `ProposalTakePushJson`, without the proposal. */
type TakePushLists = {
  commit: string | null;
  taken: {
    path: string;
    change: "added" | "modified" | "deleted";
    binary: boolean;
  }[];
  keptOurs: { path: string; reason: "both-changed" | "val-content" }[];
  notTaken: { path: string; reason: string }[];
  rewritten: boolean;
  merges: string[];
};

type MockProposalEvent =
  | {
      kind: "code-mode";
      actorId: string;
      at: string;
      data: { on: boolean };
    }
  | {
      kind: "committed";
      actorId: string;
      at: string;
      data: { gitSha: string; save: string; message: string; publish: boolean };
    }
  | {
      kind: "push-taken";
      actorId: string;
      at: string;
      data: { gitSha: string } & TakePushLists;
    };

/** A new proposal's code mode and git, before anything happened to either. */
function freshProposalState(): Pick<
  MockProposal,
  "codeMode" | "events" | "git" | "built"
> {
  return {
    codeMode: { on: false, changedBy: null, changedAt: null },
    events: [],
    git: { committed: null, theirs: null, takenIn: null },
    built: null,
  };
}

/** Where the mock's repository is, for the urls a commit answers with. */
const MOCK_REPO_URL = "https://github.com/valbuild/mock-site";

function proposalOnBranch(branch: string): MockProposal | null {
  for (const proposal of state.proposals.values()) {
    if (proposal.branch === branch) return proposal;
  }
  return null;
}

/** The commits on a proposal's branch up to and including `commit`. */
function savesUpTo(proposal: MockProposal, commit: string): Set<string> {
  const at = proposal.commits.indexOf(commit);
  return new Set(at === -1 ? [] : proposal.commits.slice(0, at + 1));
}

function stagedJson(proposal: MockProposal) {
  const inputs =
    proposal.staged.length === 0
      ? null
      : // 64 hex, as `home`'s `stagedInputs` is: a staged schema names it.
        sha(
          JSON.stringify(
            proposal.staged.map((path) => [path, proposal.saved.files[path]]),
          ),
        );
  return {
    files: proposal.staged,
    inputs,
    // Nothing here builds: what is staged is served only once a build of
    // exactly these inputs is handed in (`POST /build`).
    buildRequired: inputs !== null && proposal.built?.inputs !== inputs,
  };
}

function proposalJson(proposal: MockProposal, read = false) {
  return {
    name: proposal.name,
    branch: proposal.branch,
    displayName: proposal.displayName,
    description: proposal.description,
    ownerId: proposal.ownerId,
    ownerIds: proposal.ownerId === null ? [] : [proposal.ownerId],
    status: proposal.status,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    address: null,
    changes: patchesOn(proposal.branch).filter((patch) => !patch.applied)
      .length,
    kind: "editor",
    codeMode: proposal.codeMode,
    built: proposal.built,
    pushedGitSha: proposal.git.committed?.sha ?? null,
    ...(read
      ? { staged: stagedJson(proposal), git: proposalGitJson(proposal) }
      : {}),
  };
}

/**
 * `git` on a read of one proposal: `null` in a project with no repository
 * (managed). Read from content's own rows, never from GitHub, so somebody
 * else's push is found by Commit, not shown here.
 */
function proposalGitJson(proposal: MockProposal) {
  if (SOURCE_MODE === "managed") return null;
  const head = proposal.saved.commit;
  const committed = proposal.git.committed;
  const takenIn = proposal.git.takenIn;
  return {
    branch: proposal.branch,
    branchUrl: `${MOCK_REPO_URL}/tree/${proposal.branch}`,
    committed,
    head,
    uncommitted: head !== null && committed?.save !== head,
    takenIn:
      takenIn === null
        ? null
        : {
            sha: takenIn.sha,
            url: takenIn.url,
            by: takenIn.by,
            at: takenIn.at,
            building: takenIn.building,
          },
  };
}

/** Their commit as home sends it: `theirs` without what the mock keeps of it. */
function theirsJson(theirs: NonNullable<MockProposal["git"]["theirs"]>) {
  const { files: _files, ...json } = theirs;
  return json;
}

/** As `commitRefusal` in home's `proposalGit.ts` words someone's push. */
function someonePushedRefusal(
  proposal: MockProposal,
  theirs: NonNullable<MockProposal["git"]["theirs"]>,
): { status: number; message: string; details: Record<string, unknown> } {
  const who = theirs.author?.name ?? theirs.author?.login ?? "Somebody";
  const at =
    theirs.at === null || Number.isNaN(new Date(theirs.at).getTime())
      ? null
      : `${new Date(theirs.at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return {
    status: 409,
    message: `${who} pushed to ${proposal.branch} (${theirs.sha.slice(0, 7)})${at !== null ? ` at ${at}` : ""}. Val does not commit over a push it has not seen.`,
    details: {
      code: "someone-pushed",
      branch: proposal.branch,
      branchUrl: `${MOCK_REPO_URL}/tree/${proposal.branch}`,
      expected: proposal.git.committed?.sha ?? proposal.base,
      theirs: theirsJson(theirs),
    },
  };
}

/** Why a commit of the proposal is refused, as `/commit` and `/merge` say it. */
type CommitRefusal = {
  status: number;
  body: {
    statusCode: number;
    message: string;
    details?: Record<string, unknown>;
  };
};

/**
 * `POST /proposals/:name/commit`, and the commit Publish makes first: the
 * proposal's saved state as one commit on its branch, on top of what Val
 * last pushed. Refused when somebody else pushed since (`someone-pushed`).
 * Not modeled: `committing` (one at a time is all a test makes),
 * `repository-refused`, `github-unavailable` and `no-git-root`.
 */
function commitProposal(
  proposal: MockProposal,
  input: { message: string; save?: string; by: string; publish: boolean },
):
  | {
      ok: true;
      commit: { sha: string; url: string; save: string; pushed: boolean };
    }
  | { ok: false; refusal: CommitRefusal } {
  // `home`'s `HttpError`: `{ statusCode, message, details }`.
  const refuse = (
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) => ({
    ok: false as const,
    refusal: {
      status,
      body: { statusCode: status, message, ...(details ? { details } : {}) },
    },
  });
  if (proposal.status !== "open") {
    return refuse(409, `The proposal is ${proposal.status}.`, {
      code: "not-open",
      status: proposal.status,
    });
  }
  if (SOURCE_MODE === "managed") {
    return refuse(
      409,
      "This project has no repository: there is nothing to commit to.",
      { code: "no-repository" },
    );
  }
  const head = proposal.saved.commit;
  if (head === null) {
    return refuse(
      409,
      "Nothing is saved in this proposal yet: save it first, then commit.",
      { code: "nothing-saved" },
    );
  }
  if (input.save !== undefined && input.save !== head) {
    return refuse(
      409,
      "Something was saved in this proposal since you looked: look again, then commit.",
      { code: "saved-since", head },
    );
  }
  const theirs = proposal.git.theirs;
  if (theirs !== null) {
    const pushed = someonePushedRefusal(proposal, theirs);
    return refuse(pushed.status, pushed.message, pushed.details);
  }
  const committed = proposal.git.committed;
  if (committed !== null && committed.save === head) {
    return {
      ok: true,
      commit: {
        sha: committed.sha,
        url: committed.url,
        save: head,
        pushed: false,
      },
    };
  }
  const gitSha = sha(
    `git:${proposal.branch}:${committed?.sha ?? proposal.base}:${head}`,
  ).slice(0, 40);
  const at = nowIso();
  proposal.git.committed = {
    sha: gitSha,
    url: `${MOCK_REPO_URL}/commit/${gitSha}`,
    save: head,
    by: input.by,
    at,
  };
  proposal.events.push({
    kind: "committed",
    actorId: input.by,
    at,
    data: {
      gitSha,
      save: head,
      message: input.message,
      publish: input.publish,
    },
  });
  return {
    ok: true,
    commit: {
      sha: gitSha,
      url: `${MOCK_REPO_URL}/commit/${gitSha}`,
      save: head,
      pushed: true,
    },
  };
}

/** Paths a proposal cannot hold, as home's take-in sorts them. */
const NOT_PROJECT_SOURCE =
  /^(node_modules|\.git|\.val|dist|\.output|\.vinxi)\//;

/**
 * `POST /proposals/:name/take-push` (home's take-push contract): somebody's
 * push to the proposal's branch brought in. Their changed files are staged
 * where the proposal did not change them; where it did, its version stays
 * (`keptOurs`). Their commit becomes what Val expects at the branch, so the
 * next Commit goes on top of it. Content does not build: the Studio does, and
 * `git.takenIn.building` -- which Publish waits for -- stays until a build of
 * what the proposal holds is handed in (`POST /build`).
 *
 * The mock does not model `too-many-files` beyond counting, `unreadable`,
 * `github-unavailable`, `committing`, `no-git-root`, rewritten history,
 * merge commits, binary files, or plan refusals.
 */
async function proposalTakePush(
  req: IncomingMessage,
  res: ServerResponse,
  proposal: MockProposal,
  owner: string | null,
): Promise<void> {
  const body = await readJsonBody<{ sha?: unknown }>(req);
  const theirSha = body?.sha;
  if (typeof theirSha !== "string" || !/^[0-9a-f]{40}$/.test(theirSha)) {
    json(res, 400, { message: "The body must be { sha } with a 40-hex sha." });
    return;
  }
  if (owner === null) {
    json(res, 403, {
      message: "Proposals are changed by people: this credential names nobody",
    });
    return;
  }
  const refuse = (
    status: number,
    message: string,
    details: Record<string, unknown>,
  ) => json(res, status, { statusCode: status, message, details });
  if (proposal.status !== "open") {
    refuse(409, `The proposal is ${proposal.status}.`, {
      code: "not-open",
      status: proposal.status,
    });
    return;
  }
  if (SOURCE_MODE === "managed") {
    refuse(
      409,
      "This project has no repository: there is no push to take in.",
      {
        code: "no-repository",
      },
    );
    return;
  }
  const answerOf = (lists: TakePushLists, already: boolean) => {
    const takenIn = proposal.git.takenIn;
    return {
      theirs: {
        sha: takenIn?.sha ?? theirSha,
        url: takenIn?.url ?? `${MOCK_REPO_URL}/commit/${theirSha}`,
        message: null,
        author: null,
        at: takenIn?.at ?? null,
      },
      ...lists,
      already,
      proposal: proposalJson(proposal, true),
    };
  };
  const theirs = proposal.git.theirs;
  // Taken in already, by an earlier press, and still the tip: the same lists.
  const takenIn = proposal.git.takenIn;
  if (
    theirs === null &&
    takenIn?.sha === theirSha &&
    proposal.git.committed?.sha === theirSha
  ) {
    json(res, 200, answerOf(takenIn.answer, true));
    return;
  }
  if (theirs === null) {
    const tip = proposal.git.committed?.sha ?? proposal.base;
    refuse(
      409,
      `There is nothing to take in: ${proposal.branch} is where Val left it (${tip.slice(0, 7)}).`,
      { code: "nothing-to-take", tip },
    );
    return;
  }
  if (theirs.sha !== theirSha) {
    // Their push moved again: the new tip, to take in instead.
    const pushed = someonePushedRefusal(proposal, theirs);
    refuse(pushed.status, pushed.message, pushed.details);
    return;
  }
  const changed = Object.entries(theirs.files);
  if (changed.length > 1000) {
    refuse(
      409,
      `Their push changes ${changed.length} files, and Val takes in at most 1000 at a time.`,
      { code: "too-many-files", count: changed.length, max: 1000 },
    );
    return;
  }
  const lists: TakePushLists = {
    commit: null,
    taken: [],
    keptOurs: [],
    notTaken: [],
    rewritten: false,
    merges: [],
  };
  const toStage: Record<string, string | null> = {};
  for (const [filePath, text] of changed) {
    if (NOT_PROJECT_SOURCE.test(filePath)) {
      lists.notTaken.push({ path: filePath, reason: "not-project-source" });
      continue;
    }
    const ours = proposal.saved.files[filePath];
    // Changed by the proposal since their push started: not a file it holds
    // only because an earlier push of theirs was taken in.
    const oursChanged =
      ours !== undefined &&
      !(
        takenIn !== null &&
        filePath in takenIn.files &&
        takenIn.files[filePath] === ours
      );
    if (oursChanged && ours !== text) {
      // The proposal changed it too: Val's wins.
      const isContent =
        filePath.endsWith(".val.ts") &&
        `/${filePath}` in proposal.saved.modules;
      lists.keptOurs.push({
        path: filePath,
        reason: isContent ? "val-content" : "both-changed",
      });
      continue;
    }
    const onSite = await readRepoFile("/", filePath);
    lists.taken.push({
      path: filePath,
      change:
        text === null ? "deleted" : "value" in onSite ? "modified" : "added",
      binary: false,
    });
    if (ours !== text) toStage[filePath] = text;
  }
  const headBefore = proposal.saved.commit;
  const allCommitted =
    headBefore === null || proposal.git.committed?.save === headBefore;
  if (Object.keys(toStage).length > 0) {
    lists.commit = proposalCommit(
      proposal,
      owner,
      `Their push (${theirSha.slice(0, 7)})`,
    );
    for (const [filePath, text] of Object.entries(toStage)) {
      proposal.saved.files[filePath] = text;
      if (!proposal.staged.includes(filePath)) proposal.staged.push(filePath);
    }
  }
  const at = nowIso();
  // Their commit is the next Commit's parent. The branch holds exactly what
  // the proposal does only when nothing was kept or left out.
  const exact =
    lists.keptOurs.length === 0 && lists.notTaken.length === 0 && allCommitted;
  proposal.git.committed = {
    sha: theirs.sha,
    url: theirs.url,
    save: exact ? proposal.saved.commit : null,
    by: null,
    at: theirs.at,
  };
  proposal.git.theirs = null;
  proposal.git.takenIn = {
    sha: theirs.sha,
    url: theirs.url,
    by: owner,
    at,
    building: stagedJson(proposal).buildRequired,
    answer: lists,
    files: {
      ...(takenIn?.files ?? {}),
      ...Object.fromEntries(
        lists.taken.map((file) => [file.path, theirs.files[file.path] ?? null]),
      ),
    },
  };
  proposal.events.push({
    kind: "push-taken",
    actorId: owner,
    at,
    data: { gitSha: theirs.sha, ...lists },
  });
  proposal.updatedAt = at;
  json(res, 200, {
    ...answerOf(lists, false),
    theirs: theirsJson(theirs),
  });
}

/**
 * `POST /proposals/:name/build` with `{ publishId, inputs }`: a build of its
 * staged files, uploaded, served at its address. The mock builds and serves
 * nothing: it records that a build of these inputs is served, which is what
 * a taken-in push waits for. Any other body (Val Build's own build) is not
 * modeled.
 */
async function proposalServeBuild(
  req: IncomingMessage,
  res: ServerResponse,
  proposal: MockProposal,
): Promise<void> {
  const body = await readJsonBody<{ publishId?: unknown; inputs?: unknown }>(
    req,
  );
  if (typeof body?.publishId !== "string" || typeof body.inputs !== "string") {
    json(res, 404, {
      message:
        "Not modeled by this mock: POST /proposals/:name/build without a publishId",
    });
    return;
  }
  const inputs = stagedJson(proposal).inputs;
  if (inputs !== body.inputs) {
    json(res, 409, {
      statusCode: 409,
      message:
        "The proposal's files changed since this build was made. Build it again.",
    });
    return;
  }
  proposal.built = { hash: sha(body.publishId).slice(0, 12), inputs };
  if (proposal.git.takenIn !== null) proposal.git.takenIn.building = false;
  proposal.updatedAt = nowIso();
  json(res, 200, { proposal: proposalJson(proposal, true) });
}

/** A commit on a proposal's branch: a save, or a staging. */
function proposalCommit(
  proposal: MockProposal,
  committer: string,
  message: string | null,
): string {
  const parentCommitSha = proposal.saved.commit ?? proposal.base;
  const commitSha = sha(
    `${proposal.branch}:${parentCommitSha}:${state.commits.length}`,
  ).slice(0, 40);
  const record: MockCommit = {
    commitSha,
    clientCommitSha: commitSha,
    parentCommitSha,
    commitMessage: message,
    branch: proposal.branch,
    creator: committer,
    createdAt: nowIso(),
  };
  state.commits.push(record);
  proposal.commits.push(commitSha);
  proposal.saved.commit = commitSha;
  proposal.updatedAt = record.createdAt;
  return commitSha;
}

/** The repository path a commit's file is under: no leading slash, as the overlay names it. */
function repoPathOf(root: string | undefined, filePath: string): string {
  return path.posix.join(root || "/", filePath).replace(/^\/+/, "");
}

/**
 * `POST /proposals/:name/save` -- `postProposalSave`: `/commit`'s body and
 * answer, onto the proposal's branch. The site's files and head do not move.
 */
async function proposalSave(
  req: IncomingMessage,
  res: ServerResponse,
  proposal: MockProposal,
): Promise<void> {
  const body = await readJsonBody<CommitBody>(req);
  if (!body) {
    json(res, 400, { message: "Invalid commit body" });
    return;
  }
  if (body.newBranch !== undefined) {
    json(res, 400, { message: "A save in a proposal makes no branch." });
    return;
  }
  const applied = Object.values(body.appliedPatches ?? {}).flat();
  const notHere = applied.filter(
    (patchId) => state.patches.get(patchId)?.branch !== proposal.branch,
  );
  if (notHere.length > 0) {
    json(res, 400, {
      message: `Not this proposal's changes: ${notHere.join(", ")}`,
    });
    return;
  }
  const commitSha = proposalCommit(
    proposal,
    body.committer,
    body.message ?? null,
  );
  for (const patchId of applied) {
    const patch = state.patches.get(patchId);
    if (patch) patch.applied = { commitSha };
  }
  if (applied.length > 0) {
    chainVersion += 1;
    // Its Studios learn the save applied them, as the site's do of a publish.
    broadcastChain(proposal.branch);
  }
  for (const [filePath, text] of Object.entries(
    body.patchedSourceFiles ?? {},
  )) {
    proposal.saved.files[repoPathOf(body.root, filePath)] = text;
  }
  for (const [moduleFilePath, module] of Object.entries(body.modules ?? {})) {
    proposal.saved.modules[moduleFilePath] = module.source;
  }
  json(res, 200, {
    updatedFiles: Object.keys(body.patchedSourceFiles ?? {}),
    commit: commitSha,
    branch: proposal.branch,
    ...(applied.length > 0 ? { headVersion: chainVersion } : {}),
  });
}

/** `POST /proposals/:name/files` -- stage code: a commit on its branch. */
async function proposalStage(
  req: IncomingMessage,
  res: ServerResponse,
  proposal: MockProposal,
): Promise<void> {
  const body = await readJsonBody<{
    files?: Record<string, string | null>;
    message?: string;
    modules?: Record<string, unknown>;
  }>(req);
  const files = body?.files;
  if (!files || typeof files !== "object" || Object.keys(files).length === 0) {
    json(res, 400, { message: "files must name at least one file" });
    return;
  }
  // As `postProposalFiles` checks it (valbuild/home#369): only a module file
  // staged in the same request has a Source to record.
  for (const moduleFilePath of Object.keys(body?.modules ?? {})) {
    const at = moduleFilePath.replace(/^\/+/, "");
    if (moduleFilePath !== `/${at}` || typeof files[at] !== "string") {
      json(res, 400, {
        message: `Cannot record the Source of ${JSON.stringify(moduleFilePath)}: only a module file staged with it has one`,
      });
      return;
    }
  }
  const committer = req.headers["x-val-profile-id"];
  const commitSha = proposalCommit(
    proposal,
    typeof committer === "string" ? committer : "unknown",
    body?.message ?? null,
  );
  for (const [filePath, text] of Object.entries(files)) {
    const at = filePath.replace(/^\/+/, "");
    proposal.saved.files[at] = text;
    if (!proposal.staged.includes(at)) proposal.staged.push(at);
  }
  // A taken-in push waits for a build of what the proposal holds NOW.
  if (proposal.git.takenIn !== null && stagedJson(proposal).buildRequired) {
    proposal.git.takenIn.building = true;
  }
  /*
   * The Source each staged `.val.ts` declares, recorded as the module's
   * version at the staging (`stagedModuleRows` in home), so the address
   * serves the Source its code declares. Only for a module that already HAS
   * a version -- a save in this proposal, or a site commit, recorded one --
   * and whose Source it changes: home records none for a module new in the
   * proposal, whose build is what names it.
   */
  const siteModules = siteContentVersion().modules;
  for (const [moduleFilePath, source] of Object.entries(body?.modules ?? {})) {
    const now =
      moduleFilePath in proposal.saved.modules
        ? proposal.saved.modules[moduleFilePath]
        : siteModules[moduleFilePath];
    if (now === undefined) continue;
    if (JSON.stringify(now) === JSON.stringify(source)) continue;
    proposal.saved.modules[moduleFilePath] = source;
  }
  json(res, 200, { commit: commitSha, staged: stagedJson(proposal) });
}

/**
 * `GET /proposals/:name/merge-checks`, as the mock models them: open, saved,
 * and -- once somebody's push was taken in -- whether the proposal's build
 * has their code (`taken-push`, home's take-push contract).
 */
type MockMergeCheck = {
  id: string;
  ok: boolean;
  message: string;
  action?: "build";
};

function proposalMergeChecks(proposal: MockProposal): MockMergeCheck[] {
  const unsaved = patchesOn(proposal.branch).filter(
    (patch) => !patch.applied,
  ).length;
  const checks: MockMergeCheck[] = [
    {
      id: "open",
      ok: proposal.status === "open",
      message:
        proposal.status === "open"
          ? "It is open."
          : `It is ${proposal.status}.`,
    },
    {
      id: "saved",
      ok: unsaved === 0,
      message:
        unsaved === 0
          ? "Everything in it is saved."
          : `${unsaved} change(s) in it are not saved.`,
    },
  ];
  const takenIn = proposal.git.takenIn;
  if (takenIn !== null) {
    const short = takenIn.sha.slice(0, 7);
    checks.push(
      takenIn.building
        ? {
            id: "taken-push",
            ok: false,
            message: `Their push (${short}) is not in the proposal's build yet: build the proposal, then publish`,
            action: "build",
          }
        : {
            id: "taken-push",
            ok: true,
            message: `The proposal's build includes their push (${short})`,
          },
    );
  }
  return checks;
}

/**
 * `POST /proposals/:name/merge`: Publish in a proposal. `home` answers with a
 * request and a publish job a tab runs -- merge-prepare, build, upload --
 * before content seals it. The mock seals it at the press: the site's files
 * take the proposal's saved text, the site gets a commit carrying its saved
 * modules, and the proposal is merged. Its unsaved changes stay on its
 * branch. Idempotent on `requestId`, as `home`'s is.
 */
async function proposalMerge(
  req: IncomingMessage,
  res: ServerResponse,
  proposal: MockProposal,
): Promise<void> {
  const body = await readJsonBody<{
    requestId?: string;
    tab?: string;
    commitMessage?: string;
  }>(req);
  const requestId = body?.requestId;
  if (typeof requestId !== "string" || typeof body?.tab !== "string") {
    json(res, 400, { message: "requestId and tab are required" });
    return;
  }
  const known = state.publishRequests.get(requestId);
  if (known !== undefined) {
    json(res, 200, { request: known.status, job: null });
    return;
  }
  if (proposal.status !== "open") {
    json(res, 409, { message: `The proposal is ${proposal.status}.` });
    return;
  }
  /*
   * A failing merge check refuses the press, as home's does. Only the
   * taken-in push's is enforced here: the mock's other checks were never
   * enforced at the press, and scenarios press with changes unsaved.
   */
  const checks = proposalMergeChecks(proposal);
  if (checks.some((check) => check.id === "taken-push" && !check.ok)) {
    const failing = checks.filter((check) => !check.ok);
    json(res, 409, {
      statusCode: 409,
      message: failing.map((check) => check.message).join(". "),
      details: { checks },
    });
    return;
  }
  if (proposal.saved.commit === null) {
    const status: MockPublishRequestStatus = { kind: "nothing-to-publish" };
    state.publishRequests.set(requestId, { requestId, status, jobId: null });
    json(res, 200, { request: status, job: null });
    return;
  }
  const committer = req.headers["x-val-profile-id"];
  /*
   * Publish commits first, in a connected project, exactly as Commit does --
   * a no-op when nothing was saved since -- and a refused commit refuses the
   * Publish with the same answer. The proposal stays open.
   */
  if (SOURCE_MODE !== "managed") {
    const committed = commitProposal(proposal, {
      message:
        typeof body.commitMessage === "string" &&
        body.commitMessage.trim() !== ""
          ? body.commitMessage.trim()
          : `Published “${proposal.displayName}”`,
      by: typeof committer === "string" ? committer : "unknown",
      publish: true,
    });
    if (!committed.ok) {
      json(res, committed.refusal.status, committed.refusal.body);
      return;
    }
  }
  const modules: Record<string, { source: unknown; schema: unknown }> = {};
  for (const [moduleFilePath, source] of Object.entries(
    proposal.saved.modules,
  )) {
    modules[moduleFilePath] = { source, schema: null };
  }
  const patchedSourceFiles: Record<string, string | null> = {};
  for (const [filePath, text] of Object.entries(proposal.saved.files)) {
    patchedSourceFiles[`/${filePath}`] = text;
  }
  const recorded = recordCommit({
    patchedSourceFiles,
    patchedBinaryFilesDescriptors: {},
    appliedPatches: {},
    root: "/",
    message: `Merge ${proposal.displayName}`,
    committer: typeof committer === "string" ? committer : "unknown",
    modules,
  });
  if ("error" in recorded) {
    json(res, 400, { message: recorded.error });
    return;
  }
  proposal.status = "merged";
  proposal.updatedAt = nowIso();
  const status: MockPublishRequestStatus = {
    kind: "live",
    commit: recorded.commitSha,
  };
  state.publishRequests.set(requestId, { requestId, status, jobId: null });
  json(res, 200, { request: status, job: null });
}

/** `/v1/{project}/proposals[/...]`: the routes `ValOpsHttp` reaches. */
async function proposalsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  rest: string,
): Promise<void> {
  if (!state.proposalsEnabled) {
    json(res, 404, { message: "Proposals are not turned on for this project" });
    return;
  }
  const profile = req.headers["x-val-profile-id"];
  const owner = typeof profile === "string" ? profile : null;
  if (rest === "/proposals") {
    if (req.method === "GET") {
      json(res, 200, {
        proposals: [...state.proposals.values()].map((p) => proposalJson(p)),
        siteUrl: null,
      });
      return;
    }
    if (req.method === "POST") {
      const body = await readJsonBody<{
        displayName?: string;
        description?: string;
        base?: string | null;
        patchIds?: string[];
        requestId?: string;
        kind?: string;
      }>(req);
      if (!body || typeof body.displayName !== "string") {
        json(res, 400, { message: "displayName is required" });
        return;
      }
      if (body.kind !== undefined && body.kind !== "editor") {
        json(res, 400, { message: `This mock opens editor proposals only.` });
        return;
      }
      if (
        body.base !== undefined &&
        body.base !== null &&
        body.base !== state.headCommitSha
      ) {
        json(res, 409, {
          message: "The site has moved: base is not its head.",
        });
        return;
      }
      const requestId = body.requestId ?? randomUUID();
      for (const existing of state.proposals.values()) {
        if (existing.requestId === requestId) {
          json(res, 200, {
            proposal: proposalJson(existing),
            movedPatchIds: [],
          });
          return;
        }
      }
      // Twenty hex characters, the hash of its inputs.
      const name = sha(`${state.headCommitSha}:${requestId}`).slice(0, 20);
      const now = nowIso();
      const proposal: MockProposal = {
        name,
        branch: `val/p/${name}`,
        displayName: body.displayName,
        description: body.description ?? null,
        ownerId: owner,
        status: "open",
        createdAt: now,
        updatedAt: now,
        requestId,
        base: state.headCommitSha,
        saved: { commit: null, modules: {}, files: {} },
        commits: [],
        staged: [],
        ...freshProposalState(),
      };
      state.proposals.set(name, proposal);
      // A re-key, never a copy: the site's pending changes move in whole.
      const moved: string[] = [];
      for (const patchId of body.patchIds ?? []) {
        const patch = state.patches.get(patchId);
        if (patch && patch.branch === PROJECT_BRANCH && !patch.applied) {
          patch.branch = proposal.branch;
          moved.push(patchId);
        }
      }
      if (moved.length > 0) {
        chainVersion += 1;
        broadcastChain();
        broadcastChain(proposal.branch);
      }
      json(res, 200, {
        proposal: proposalJson(proposal),
        movedPatchIds: moved,
      });
      return;
    }
  }
  const match = /^\/proposals\/([0-9a-f]{20})(\/.*)?$/.exec(rest);
  const proposal = match === null ? undefined : state.proposals.get(match[1]);
  if (match === null || proposal === undefined) {
    json(res, 404, { message: "No such proposal" });
    return;
  }
  const route = `${req.method} ${match[2] ?? ""}`;
  switch (route) {
    case "GET ":
      json(res, 200, {
        proposal: proposalJson(proposal, true),
        events: proposal.events,
      });
      return;
    case "POST /code-mode": {
      // The flag only: the save before it is Val's server's.
      const body = await readJsonBody<{ on?: unknown }>(req);
      if (typeof body?.on !== "boolean") {
        json(res, 400, { message: "The body must be { on: boolean }." });
        return;
      }
      if (owner === null) {
        json(res, 403, {
          message:
            "Proposals are changed by people: this credential names nobody",
        });
        return;
      }
      if (proposal.status !== "open") {
        json(res, 409, {
          statusCode: 409,
          message: `The proposal is ${proposal.status}: code mode is for an open proposal.`,
          details: { code: "not-open", status: proposal.status },
        });
        return;
      }
      if (proposal.codeMode.on !== body.on) {
        const at = nowIso();
        proposal.codeMode = { on: body.on, changedBy: owner, changedAt: at };
        proposal.events.push({
          kind: "code-mode",
          actorId: owner,
          at,
          data: { on: body.on },
        });
      }
      json(res, 200, { proposal: proposalJson(proposal, true) });
      return;
    }
    case "POST /commit": {
      const body = await readJsonBody<{ message?: unknown; save?: unknown }>(
        req,
      );
      const message =
        typeof body?.message === "string" ? body.message.trim() : "";
      if (message === "" || message.length > 5000) {
        json(res, 400, {
          message: "A commit needs a message of 1 to 5000 characters.",
        });
        return;
      }
      if (owner === null) {
        json(res, 403, {
          message:
            "Proposals are changed by people: this credential names nobody",
        });
        return;
      }
      const committed = commitProposal(proposal, {
        message,
        ...(typeof body?.save === "string" ? { save: body.save } : {}),
        by: owner,
        publish: false,
      });
      if (!committed.ok) {
        json(res, committed.refusal.status, committed.refusal.body);
        return;
      }
      json(res, 200, {
        commit: committed.commit,
        proposal: proposalJson(proposal, true),
      });
      return;
    }
    case "PATCH ": {
      const body = await readJsonBody<{
        displayName?: string;
        description?: string;
      }>(req);
      if (typeof body?.displayName === "string") {
        proposal.displayName = body.displayName;
      }
      if (typeof body?.description === "string") {
        proposal.description = body.description;
      }
      proposal.updatedAt = nowIso();
      json(res, 200, { proposal: proposalJson(proposal) });
      return;
    }
    case "POST /save":
      await proposalSave(req, res, proposal);
      return;
    case "GET /files":
      json(res, 200, {
        files: proposal.saved.files,
        staged: stagedJson(proposal),
      });
      return;
    case "POST /files":
      if (proposal.status !== "open") {
        json(res, 409, { message: `The proposal is ${proposal.status}.` });
        return;
      }
      await proposalStage(req, res, proposal);
      return;
    case "GET /merge-checks": {
      const checks = proposalMergeChecks(proposal);
      json(res, 200, { checks, canMerge: checks.every((check) => check.ok) });
      return;
    }
    case "POST /merge":
      await proposalMerge(req, res, proposal);
      return;
    case "POST /take-push":
      await proposalTakePush(req, res, proposal, owner);
      return;
    case "POST /build":
      await proposalServeBuild(req, res, proposal);
      return;
    case "POST /close":
    case "POST /reopen":
      proposal.status = route === "POST /close" ? "closed" : "open";
      proposal.updatedAt = nowIso();
      json(res, 200, { proposal: proposalJson(proposal) });
      return;
    default:
      json(res, 404, {
        message: `Not modeled by this mock: ${req.method} /proposals/:name${match[2] ?? ""}`,
      });
  }
}

/**
 * What the platform serves a proposal's address from (`VAL_OVERLAY`,
 * `VAL_PROPOSAL`, `VAL_BRANCH`): `home`'s overlay step writes it from the
 * saved state after every save (`overlayStep`), with deleted files left out
 * (`shippedFiles`). Read by a test as the platform would hand it to the next
 * isolate.
 */
function proposalOverlay(proposal: MockProposal) {
  const files: Record<string, string> = {};
  for (const [filePath, text] of Object.entries(proposal.saved.files)) {
    if (text !== null) files[filePath] = text;
  }
  return {
    name: proposal.name,
    branch: proposal.branch,
    commit: proposal.saved.commit,
    modules: proposal.saved.modules,
    files,
    staged: stagedSchemas(proposal),
  };
}

/**
 * The overlay's `staged`, as `home`'s `stagedSchemas` makes it: every staged
 * MODULE file (`.val.ts` / `.val.js`, not deleted), by module file path, with
 * the schema version a staging records for it, `staged:<inputs>` -- code
 * nobody has evaluated, named by the staging it came with. `{}` when nothing
 * that is a module is staged. This mock keeps no version index, so this is
 * where the record shows.
 */
function stagedSchemas(proposal: MockProposal): Record<string, string> {
  const inputs = stagedJson(proposal).inputs;
  if (inputs === null) return {};
  const staged: Record<string, string> = {};
  for (const path of [...proposal.staged].sort()) {
    if (!/\.val\.(ts|js)$/.test(path)) continue;
    if (typeof proposal.saved.files[path] !== "string") continue;
    staged[`/${path}`] = `staged:${inputs}`;
  }
  return staged;
}

/**
 * The site's content since the bundle the test built from, as the platform
 * hands a content version to a site isolate after a publish that did not
 * rebuild (`VAL_CONTENT`): every module the site's commits recorded, at its
 * latest, and every text file they wrote.
 */
function siteContentVersion() {
  const modules: Record<string, unknown> = {};
  for (const commit of state.commits) {
    if (commit.branch !== PROJECT_BRANCH) continue;
    const archive = state.archives.get(commit.commitSha);
    for (const [moduleFilePath, module] of Object.entries(
      archive?.modules ?? {},
    )) {
      modules[moduleFilePath] = module.source;
    }
  }
  const files: Record<string, string> = {};
  for (const [filePath, value] of state.repoOverlay) {
    if (value !== null && value.encoding === "utf8") {
      files[filePath.replace(/^\/+/, "")] = value.value;
    }
  }
  return {
    id: sha(`${state.headCommitSha}:version`).slice(0, 20),
    job: null,
    commit: state.headCommitSha,
    modules,
    files,
  };
}

// #endregion

const controlPlane: Handler = async (req, res, url) => {
  const action = url.pathname.slice("/__test__/".length);
  if (action === "reset" && req.method === "POST") {
    state = emptyState();
    countedDeployments = [];
    buildBases = new Map();
    /*
     * A reset changes the chain -- every patch is gone -- so it moves the
     * chain version, as every write and delete does. Val's server keeps the
     * chain under it (`GET /chain/version`: the head's "has the chain
     * moved?"), and a reset that left it where it was had the next spec's
     * Studio read the previous spec's patches.
     */
    chainVersion += 1;
    json(res, 200, { ok: true });
    return;
  }
  if (action === "publish-jobs" && req.method === "POST") {
    /*
     * Make this project publish as jobs. A switch: a connected project that
     * commits is what every other spec runs against.
     */
    const body = await readJsonBody<{ enabled?: boolean }>(req);
    state.publishJobsEnabled = body?.enabled !== false;
    json(res, 200, { ok: true, enabled: state.publishJobsEnabled });
    return;
  }
  if (action === "proposals-enabled" && req.method === "POST") {
    // Turn proposals on for this project, as a project setting does in home.
    const body = await readJsonBody<{ enabled?: boolean }>(req);
    state.proposalsEnabled = body?.enabled !== false;
    json(res, 200, { ok: true, enabled: state.proposalsEnabled });
    return;
  }
  if (action === "proposals" && req.method === "POST") {
    /*
     * A proposal that already exists on content, with what its saves left:
     * for a test that starts at the address of one rather than opening it.
     */
    const body = await readJsonBody<{
      name?: string;
      branch?: string;
      commit?: string | null;
      modules?: Record<string, unknown>;
      files?: Record<string, string>;
    }>(req);
    if (
      typeof body?.name !== "string" ||
      !/^[0-9a-f]{20}$/.test(body.name) ||
      typeof body.branch !== "string"
    ) {
      json(res, 400, { message: "name (20 hex) and branch are required" });
      return;
    }
    const now = nowIso();
    const commit = body.commit ?? null;
    state.proposalsEnabled = true;
    state.proposals.set(body.name, {
      name: body.name,
      branch: body.branch,
      displayName: body.name,
      description: null,
      ownerId: null,
      status: "open",
      createdAt: now,
      updatedAt: now,
      requestId: body.name,
      base: state.headCommitSha,
      saved: { commit, modules: body.modules ?? {}, files: body.files ?? {} },
      commits: commit === null ? [] : [commit],
      staged: [],
      ...freshProposalState(),
    });
    json(res, 200, { ok: true });
    return;
  }
  const pushed = /^proposals\/([0-9a-f]{20})\/push$/.exec(action);
  if (pushed !== null && req.method === "POST") {
    /*
     * Somebody else pushes to the proposal's branch, as a developer does from
     * a laptop: Val has not seen it, so its next Commit is refused
     * (`someone-pushed`). `files`: what the push changes (project paths,
     * `null` deletes), which taking it in stages. A second push before it is
     * taken in moves the tip on top of the first: both pushes' files are
     * what is taken in. `{ clear: true }` takes it back.
     */
    const proposal = state.proposals.get(pushed[1]);
    if (proposal === undefined) {
      json(res, 404, { message: "No such proposal" });
      return;
    }
    const body = await readJsonBody<{
      clear?: boolean;
      message?: string;
      author?: { name?: string; login?: string };
      at?: string;
      files?: Record<string, string | null>;
    }>(req);
    if (body?.clear === true) {
      proposal.git.theirs = null;
      json(res, 200, { ok: true });
      return;
    }
    const before = proposal.git.theirs;
    const theirSha = sha(
      `theirs:${proposal.branch}:${before?.sha ?? ""}:${nowIso()}`,
    ).slice(0, 40);
    proposal.git.theirs = {
      sha: theirSha,
      url: `${MOCK_REPO_URL}/commit/${theirSha}`,
      message: body?.message ?? null,
      author: {
        name: body?.author?.name ?? null,
        email: null,
        login: body?.author?.login ?? null,
        avatarUrl: null,
      },
      at: body?.at ?? nowIso(),
      files: { ...(before?.files ?? {}), ...(body?.files ?? {}) },
    };
    json(res, 200, { ok: true, sha: theirSha });
    return;
  }
  const overlay = /^proposals\/([0-9a-f]{20})\/overlay$/.exec(action);
  if (overlay !== null && req.method === "GET") {
    const proposal = state.proposals.get(overlay[1]);
    if (proposal === undefined) {
      json(res, 404, { message: "No such proposal" });
      return;
    }
    json(res, 200, proposalOverlay(proposal));
    return;
  }
  /*
   * What the platform hands the isolate at the proposal's address, as the
   * loader's `dynamicEnv` names it: the proposal, its overlay as JSON, and
   * which staging the build serving it was made of (`VAL_BUILD_INPUTS`, the
   * overlay's `codeInputs` in home), when a build of its own serves it. Read
   * by the scenario world with Val's `proposalFromEnv`.
   */
  const env = /^proposals\/([0-9a-f]{20})\/env$/.exec(action);
  if (env !== null && req.method === "GET") {
    const proposal = state.proposals.get(env[1]);
    if (proposal === undefined) {
      json(res, 404, { message: "No such proposal" });
      return;
    }
    const {
      name: _name,
      branch: _branch,
      ...handed
    } = proposalOverlay(proposal);
    json(res, 200, {
      VAL_PROPOSAL: proposal.name,
      VAL_BRANCH: proposal.branch,
      VAL_OVERLAY: JSON.stringify(handed),
      ...(proposal.built !== null
        ? { VAL_BUILD_INPUTS: proposal.built.inputs }
        : {}),
    });
    return;
  }
  /*
   * The platform built what is staged NOW and serves it at the address: what
   * a build a test does not run through `POST /proposals/:name/build` (the
   * Studio's Build) leaves content holding. `hash` names the build.
   */
  const built = /^proposals\/([0-9a-f]{20})\/built$/.exec(action);
  if (built !== null && req.method === "POST") {
    const proposal = state.proposals.get(built[1]);
    if (proposal === undefined) {
      json(res, 404, { message: "No such proposal" });
      return;
    }
    const body = await readJsonBody<{ hash?: string }>(req);
    const inputs = stagedJson(proposal).inputs;
    // A build of these inputs already served (the Studio's Build) stays.
    if (proposal.built?.inputs !== inputs || body?.hash !== undefined) {
      proposal.built =
        inputs === null
          ? null
          : {
              hash: body?.hash ?? sha(`built:${inputs}`).slice(0, 12),
              inputs,
            };
    }
    if (proposal.built !== null && proposal.git.takenIn !== null) {
      proposal.git.takenIn.building = false;
    }
    json(res, 200, { ok: true, built: proposal.built });
    return;
  }
  if (action === "project-source" && req.method === "PUT") {
    // What a publish leaves the platform holding: the live build's files.
    const body = await readJsonBody<{
      files?: Record<string, string> | null;
    }>(req);
    state.projectSource = body?.files ?? null;
    json(res, 200, { ok: true });
    return;
  }
  if (action === "content-version" && req.method === "GET") {
    json(res, 200, siteContentVersion());
    return;
  }
  if (action === "state" && req.method === "GET") {
    json(res, 200, {
      patches: [...state.patches.values()].map((patch) => ({
        patchId: patch.patchId,
        path: patch.path,
        authorId: patch.authorId,
        applied: patch.applied,
        parentPatchId: patch.parentPatchId,
      })),
      /**
       * Every uploaded file, whatever state its patch is in.
       *
       * Top-level rather than nested under its patch so a test can assert on an
       * upload without first waiting for the patch to be saved — and the `remote`
       * flag is here because it is the only way to tell a remote upload from a
       * local one: both arrive on the same endpoint with the same body.
       */
      patchFiles: [...state.patchFiles.entries()].flatMap(([patchId, files]) =>
        [...files.entries()].map(([filePath, file]) => ({
          patchId,
          filePath,
          type: file.type,
          remote: file.remote,
          bytes: file.bytes.byteLength,
          source: file.source,
        })),
      ),
      commits: state.commits,
      deployments: state.deployments,
      repoOverlay: [...state.repoOverlay.keys()],
      remoteFiles: [...state.remoteFiles.keys()],
      /** Publish jobs, without what their prepare was sent. */
      publishJobs: [...state.publishJobs.values()].map((job) => ({
        id: job.id,
        step: job.step,
        done: job.done,
        patches: job.patches,
        requestIds: job.requestIds,
        binaryFiles: job.prepared?.patchedBinaryFilesDescriptors ?? null,
      })),
      publishRequests: [...state.publishRequests.values()],
      /** Which commits history can read in full. See `State.archives`. */
      archives: [...state.archives.keys()],
      headCommitSha: state.headCommitSha,
      subscribers: sockets.size,
      socketsAccepted,
    });
    return;
  }
  if (action === "archive" && req.method === "GET") {
    /*
     * The archive one commit was recorded with, for asserting on what a publish
     * actually stored — which is the boundary history depends on. A test that
     * only reads the app's `/history/commit` cannot tell "the client never sent
     * the pre-commit text" from "the server never recorded it"; this can.
     */
    const commitSha = url.searchParams.get("commit");
    if (!commitSha) {
      json(res, 400, { message: "commit is required" });
      return;
    }
    const archive = state.archives.get(commitSha);
    json(res, 200, {
      archive: archive
        ? {
            ...archive,
            patches: archive.patches.map((patch) => ({
              patchId: patch.patchId,
              path: patch.path,
              patch: patch.patch,
              coreVersion: patch.coreVersion,
            })),
          }
        : null,
    });
    return;
  }
  if (action === "ai-script" && req.method === "POST") {
    const body = await readJsonBody<AiScript>(req);
    if (!body || !Array.isArray(body.steps)) {
      json(res, 400, { message: "An ai script needs a steps array" });
      return;
    }
    state.aiScripts.push(body);
    json(res, 200, { queued: state.aiScripts.length });
    return;
  }
  if (action === "ai-session-sha256" && req.method === "POST") {
    const body = await readJsonBody<{ enabled?: boolean }>(req);
    state.aiSessionSha256 = body?.enabled !== false;
    json(res, 200, { enabled: state.aiSessionSha256 });
    return;
  }
  if (action === "ai-offline" && req.method === "POST") {
    const body = await readJsonBody<{ offline?: boolean }>(req);
    state.aiOffline = body?.offline !== false;
    json(res, 200, { offline: state.aiOffline });
    return;
  }
  if (action === "ai-state" && req.method === "GET") {
    json(res, 200, {
      prompts: state.aiPrompts,
      toolCalls: state.aiToolCalls,
      sessions: [...state.aiSessions.values()],
      images: [...state.aiImages.values()].map((image) => ({
        key: image.key,
        sessionId: image.sessionId,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        bytes: image.data.byteLength,
      })),
      queuedScripts: state.aiScripts.length,
    });
    return;
  }
  if (action === "committed-source" && req.method === "GET") {
    const key = url.searchParams.get("path");
    if (!key) {
      json(res, 400, { message: "path is required" });
      return;
    }
    const overlaid = state.repoOverlay.get(key);
    json(res, 200, {
      // Text only: this endpoint exists for asserting on committed source, and
      // an image's bytes are stored base64 — handing those back as `content`
      // would be neither readable nor safe to compare.
      content: overlaid && overlaid.encoding === "utf8" ? overlaid.value : null,
      /**
       * How big the committed file is, whatever its encoding.
       *
       * The only thing a test can check about committed BYTES, and it is worth
       * checking: a commit that carries the wrong bytes still puts the path in
       * the overlay, so asserting on the path alone passed while the file was a
       * UUID where a PNG should have been.
       */
      bytes:
        overlaid === undefined || overlaid === null
          ? null
          : Buffer.from(
              overlaid.value,
              overlaid.encoding === "base64" ? "base64" : "utf-8",
            ).byteLength,
    });
    return;
  }
  if (action === "deployment" && req.method === "POST") {
    const body = await readJsonBody<{
      commitSha?: string;
      deploymentId?: string;
      deploymentState?: string;
      /**
       * Whether to push this down the socket.
       *
       * Off is not a hypothetical: the socket only carries what the content
       * service's database trigger fires while a Studio happens to be
       * connected, so a reconnect, a dropped frame or a deployment that moved
       * before anyone opened the Studio all reach the browser only on the next
       * `/stat`. A test can say so with this.
       */
      broadcast?: boolean;
      /**
       * The branch it deployed, as `home` asks GitHub for it: the branch
       * whose chain version a `success` moves. The project's by default.
       */
      branch?: string;
      /**
       * The build this deployment serves, as a Val server there names it
       * (`publishBuild`, the platform's `VAL_BUILD`): what `home` reads off a
       * counted publish (`build_hash`). Absent: the build is known by its
       * commit, as a GitHub deployment's is.
       */
      build?: string;
    }>(req);
    const deploymentId = body?.deploymentId ?? randomUUID();
    const commitSha = body?.commitSha ?? state.headCommitSha;
    const deploymentState = body?.deploymentState ?? "pending";
    const branch = body?.branch ?? PROJECT_BRANCH;
    // The build it serves, as `home` names a counted deployment's: a publish's
    // build hash when the test says one, else the commit GitHub reported.
    const build =
      body?.build !== undefined ? `build:${body.build}` : `commit:${commitSha}`;
    const existing = state.deployments.find(
      (d) => d.deploymentId === deploymentId,
    );
    const record: MockDeployment = existing
      ? Object.assign(existing, { deploymentState, updatedAt: nowIso() })
      : {
          deploymentId,
          commitSha,
          deploymentState,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
    if (!existing) {
      state.deployments.push(record);
    }
    if (body?.broadcast !== false) {
      broadcast({ type: "deployment", deployment: record });
    }
    // Live: a new build answers for the branch. After the deployment's own
    // message, as `home`'s two notifications commit in that order.
    const moved =
      deploymentState === "success" &&
      countDeploymentLive(branch, deploymentId, build);
    if (moved && body?.broadcast !== false) {
      broadcastChain(branch);
    }
    json(res, 200, {
      deployment: record,
      ...(moved ? { headVersion: chainVersion } : {}),
    });
    return;
  }
  if (action === "commit" && req.method === "POST") {
    const body = await readJsonBody<{
      commitMessage?: string;
      creator?: string;
      branch?: string;
    }>(req);
    const parentCommitSha = state.headCommitSha;
    const commitSha = sha(
      `push:${parentCommitSha}:${state.commits.length}`,
    ).slice(0, 40);
    const record: MockCommit = {
      commitSha,
      clientCommitSha: commitSha,
      parentCommitSha,
      commitMessage: body?.commitMessage ?? "A commit someone pushed",
      branch: body?.branch ?? "main",
      creator: body?.creator ?? "someone-else",
      createdAt: nowIso(),
    };
    state.commits.push(record);
    state.headCommitSha = commitSha;
    // A pushed commit changed nothing Val manages, so the files at it are the
    // files at its parent. Snapshotted so `/commits/{sha}/file` can answer for
    // it; deliberately NOT archived, so it stands in for a commit from before
    // archiving shipped — `hasArchive: false`, no pre-commit sources.
    state.snapshots.set(commitSha, new Map(state.repoOverlay));
    broadcast({ type: "commit", commit: record });
    json(res, 200, { commit: record });
    return;
  }
  json(res, 404, { message: `Unknown control action: ${action}` });
};

// #endregion

// #region routing

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    requestOrigins.set(res, origin);
  }
  void handle(req, res).catch((err) => {
    console.error("[mock-content-host] unhandled error", err);
    if (!res.headersSent) {
      json(res, 500, {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(res));
    res.end();
    return;
  }
  if (url.pathname === "/__test__/ping") {
    json(res, 200, { ok: true, project: PROJECT });
    return;
  }
  if (url.pathname.startsWith("/__test__/")) {
    await controlPlane(req, res, url);
    return;
  }
  // The publish API: a publish token names the project, so its routes do not.
  if (
    /^\/v1\/(publish-requests|publish-jobs|ci-runs)(\/|$)/.test(url.pathname) ||
    url.pathname === "/v1/project-source"
  ) {
    await publishApi(req, res, url.pathname.slice("/v1".length));
    return;
  }
  const prefix = `/v1/${PROJECT}`;
  if (!url.pathname.startsWith(prefix)) {
    json(res, 404, { message: `Not a route on this mock: ${url.pathname}` });
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { message: "Unauthorized: bad or missing api key / nonce" });
    return;
  }
  const rest = url.pathname.slice(prefix.length) || "/";
  const route = `${req.method} ${rest}`;
  // Patch-file routes carry the patch id in the path, so they are matched by
  // shape rather than by an exact string.
  if (/^\/patches\/[^/]+\/files$/.test(rest)) {
    if (req.method === "POST") {
      await savePatchFile(req, res, url);
      return;
    }
    if (req.method === "GET") {
      getPatchFileMetadata(req, res, url);
      return;
    }
  }
  if (
    req.method === "POST" &&
    /^\/patches\/[^/]+\/files\/from-session-file$/.test(rest)
  ) {
    await aiSessionFileToPatchFile(req, res, url);
    return;
  }
  if (/^\/ai\/sessions\/[^/]+$/.test(rest) && req.method === "PATCH") {
    await aiRenameSession(req, res, url);
    return;
  }
  if (/^\/ai\/sessions\/[^/]+\/messages$/.test(rest) && req.method === "GET") {
    aiSessionMessages(req, res, url);
    return;
  }
  if (req.method === "PUT" && rest.startsWith("/remote/files/")) {
    await putRemoteFile(req, res, url);
    return;
  }
  if (req.method === "GET" && commitShaInPath(rest) !== null) {
    if (rest.endsWith("/patches")) {
      commitPatches(req, res, url);
    } else if (rest.endsWith("/modules")) {
      commitModules(req, res, url);
    } else if (rest.endsWith("/affected-files")) {
      commitAffectedFiles(req, res, url);
    } else {
      await commitFile(req, res, url);
    }
    return;
  }
  if (rest === "/proposals" || rest.startsWith("/proposals/")) {
    await proposalsRoute(req, res, rest);
    return;
  }
  switch (route) {
    case "GET /applicable/patches":
      getApplicablePatches(req, res, url);
      return;
    case "GET /chain/version":
      getChainVersion(req, res, url);
      return;
    case "POST /patches":
      await savePatch(req, res, url);
      return;
    case "DELETE /patches":
      await deletePatches(req, res, url);
      return;
    case "PUT /files":
      await getFiles(req, res, url);
      return;
    case "POST /publish-token":
      publishToken(req, res, url);
      return;
    case "POST /commit":
      await commit(req, res, url);
      return;
    case "POST /commit-summary":
      commitSummary(req, res, url);
      return;
    case "GET /commits":
      listCommits(req, res, url);
      return;
    case "POST /presigned-auth-nonce":
      presignedAuthNonce(req, res, url);
      return;
    case "POST /websocket/nonces":
      websocketNonce(req, res, url);
      return;
    case "GET /settings":
      settings(req, res, url);
      return;
    case "GET /profiles":
      profiles(req, res, url);
      return;
    case "POST /ai/initialize":
      aiInitialize(req, res, url);
      return;
    case "GET /ai/sessions":
      aiSessions(req, res, url);
      return;
    case "POST /ai/images":
      await aiUploadImage(req, res, url);
      return;
    case "GET /ai/images":
      aiDownloadImage(req, res, url);
      return;
    default:
      json(res, 404, { message: `Unhandled content-host route: ${route}` });
  }
}

/**
 * The socket the Studio opens for itself.
 *
 * It sends one `subscribe` with the nonce from `/stat` and then only listens.
 * The `subscribed` reply matters: without it the client sits waiting and its
 * long-poll interval never lengthens.
 */
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const message = parsed as { type?: string; nonce?: string };
    if (message.type !== "subscribe") {
      return;
    }
    if (typeof message.nonce !== "string" || !state.nonces.has(message.nonce)) {
      socket.close(1008, "Unknown nonce");
      return;
    }
    sockets.add(socket);
    socketBranch.set(
      socket,
      socketBranchOfNonce.get(message.nonce) ?? PROJECT_BRANCH,
    );
    /*
     * Counted, not just held.
     *
     * `subscribers` is a live size, so it cannot tell "this page's socket is
     * registered" from "a socket some earlier test left open". A broadcast only
     * reaches sockets already in this set, so a test that fires an event before
     * its own page is in here loses it — see `openHttpStudio`, which waits on
     * this number going up.
     */
    socketsAccepted += 1;
    socket.send(JSON.stringify({ type: "subscribed" }));
  });
  socket.on("close", () => {
    sockets.delete(socket);
  });
});

/**
 * The assistant socket, on the url the Studio's server derives from `contentUrl`.
 *
 * A prompt plays the next queued script; a tool result unblocks whichever step is
 * waiting for it. Nothing else is answered — the real service also speaks
 * `ai_get_sessions` and friends over this socket, but the Studio asks for those
 * over HTTP, so implementing them here would be inventing traffic.
 */
const aiWss = new WebSocketServer({ noServer: true });
aiWss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const message = parsed as {
      type?: string;
      toolCallId?: string;
      result?: unknown;
      isError?: boolean;
    };
    if (message.type === "ai_prompt") {
      void playAiTurn(
        socket,
        parsed as {
          id?: string;
          sessionId?: string;
          message?: unknown;
          reportUsage?: boolean;
        },
      ).catch((err) => {
        console.error("[mock-content-host] ai turn failed", err);
      });
      return;
    }
    if (message.type === "ai_tool_result" && message.toolCallId) {
      const waiting = pendingToolResults.get(message.toolCallId);
      if (waiting) {
        pendingToolResults.delete(message.toolCallId);
        waiting({
          result: message.result,
          isError: message.isError === true,
        });
      }
    }
  });
});

/**
 * Two socket endpoints on one http server, routed by path.
 *
 * `WebSocketServer({ server, path })` cannot do this: each instance adds its own
 * `upgrade` listener and destroys any socket whose path it does not recognise, so
 * a second one would kill the first one's connections. Routing here and handing
 * off with `noServer` is the shape `ws` documents for exactly this case.
 */
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (url.pathname === `/v1/${PROJECT}/ai/connect`) {
    const nonce = url.searchParams.get("nonce");
    if (!nonce || !state.nonces.has(nonce)) {
      socket.destroy();
      return;
    }
    aiWss.handleUpgrade(req, socket, head, (ws) => {
      aiWss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});

/*
 * Standalone (Playwright's `webServer`, `homeWireContract.test.ts`), it
 * listens on its port. In-process (the scenario world's `contentHost.ts`), the
 * importer sets `MOCK_CONTENT_NO_LISTEN=1` and listens on `server` itself, so
 * it decides when the host starts and stops.
 */
if (process.env.MOCK_CONTENT_NO_LISTEN !== "1") {
  server.listen(PORT, () => {
    console.log(
      `[mock-content-host] listening on http://localhost:${PORT} for project ${PROJECT}`,
    );
  });
}

/** The host's http server, for an importer that listens itself. */
export { server, handle };

// #endregion
