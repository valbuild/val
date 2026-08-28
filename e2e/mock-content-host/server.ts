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
 *   GET    /v1/{project}/applicable/patches
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
  /** A base64 data URL, the shape `bufferFromDataUrl` expects. */
  data: string;
  type: "file" | "image";
  metadata: unknown;
  remote: boolean;
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
    };

type AiScript = {
  steps: AiScriptStep[];
  /** The assistant's closing message. */
  response?: string;
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
};

type State = {
  /** Insertion-ordered: this is the patch chain. */
  patches: Map<string, MockPatch>;
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
  repoOverlay: Map<
    string,
    { encoding: "utf8" | "base64"; value: string } | null
  >;
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
};

function emptyState(): State {
  return {
    patches: new Map(),
    patchFiles: new Map(),
    commits: [],
    deployments: [],
    repoOverlay: new Map(),
    remoteFiles: new Map(),
    nonces: new Set(),
    headCommitSha: process.env.MOCK_CONTENT_INITIAL_COMMIT ?? "mockcommit0",
    aiImages: new Map(),
    aiSessions: new Map(),
    aiScripts: [],
    aiPrompts: [],
    aiToolCalls: [],
  };
}

let state = emptyState();

/** Every subscribed browser. Written to by the control plane and by commits. */
const sockets = new Set<WebSocket>();

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

/** The last patch in the chain, which is what a new patch must name as parent. */
function headPatchId(): string | null {
  let last: string | null = null;
  for (const patchId of state.patches.keys()) {
    last = patchId;
  }
  return last;
}

/**
 * Tell every subscriber what the chain is now.
 *
 * The WHOLE chain, not the ids that just changed: `useStatus` handles a `patches`
 * message by REPLACING `stat.data.patches` with what the message carries, so
 * sending only the new id would announce that every other patch had vanished.
 * Anything that adds to or removes from the chain has to call this.
 */
function broadcastChain(): void {
  broadcast({ type: "patches", patches: [...state.patches.keys()] });
}

function broadcast(message: unknown): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
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

// #endregion

// #region endpoints

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => Promise<void> | void;

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
  const patches = [];
  for (const patch of state.patches.values()) {
    if (wanted && !wanted.has(patch.patchId)) {
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
    commits: state.commits,
    deployments: state.deployments,
  });
};

/**
 * `POST /v1/{project}/patches` — save one patch.
 *
 * The parent check is the real contract, not decoration: the chain is linear and
 * single-writer, and a patch whose parent is no longer the head is a 409 the
 * client is built to recover from. Two editors racing is the case that produces
 * it, which is exactly one of the things these tests are for.
 */
const savePatch: Handler = async (req, res) => {
  const body = await readJsonBody<{
    path: string;
    patch: unknown;
    authorId: string | null;
    patchId: string;
    parentPatchId: string | null;
    baseSha: string;
  }>(req);
  if (!body || typeof body.patchId !== "string") {
    json(res, 400, { message: "Invalid save-patch body" });
    return;
  }
  if (state.patches.has(body.patchId)) {
    // Idempotent: the client retries a save it did not get an answer to.
    json(res, 200, { patchId: body.patchId });
    return;
  }
  const head = headPatchId();
  if ((body.parentPatchId ?? null) !== head) {
    res.writeHead(409, { "Content-Type": "text/plain", ...corsHeaders(res) });
    res.end(
      `Parent patch ${body.parentPatchId ?? "<head>"} is not the head of the chain (${head ?? "<empty>"})`,
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
  });
  broadcastChain();
  json(res, 200, { patchId: body.patchId });
};

/** `DELETE /v1/{project}/patches` — what discard and the auto-delete path call. */
const deletePatches: Handler = async (req, res) => {
  const body = await readJsonBody<{ patchIds: string[] }>(req);
  const ids = body?.patchIds ?? [];
  for (const patchId of ids) {
    state.patches.delete(patchId);
    state.patchFiles.delete(patchId);
  }
  broadcastChain();
  // Every id comes back as deleted, including ones that were already gone: a
  // patch someone else removed first is absent either way, and reporting that
  // as a failure would make an ordinary discard look broken.
  json(res, 200, { deleted: ids });
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
  files.set(body.filePath, {
    data: body.data,
    type: body.type,
    metadata: body.metadata,
    remote: body.remote === true,
  });
  json(res, 200, { patchId, filePath: body.filePath });
};

/** `GET /v1/{project}/patches/{patchId}/files?file_path=&remote=` — metadata only. */
const getPatchFileMetadata: Handler = (req, res, url) => {
  const patchId = url.pathname.split("/").at(-2);
  const filePath = url.searchParams.get("file_path");
  if (!patchId || !filePath) {
    json(res, 400, { message: "file_path is required" });
    return;
  }
  const file = state.patchFiles.get(patchId)?.get(filePath);
  if (!file) {
    json(res, 404, { message: `No file ${filePath} in patch ${patchId}` });
    return;
  }
  json(res, 200, { filePath, metadata: file.metadata, type: file.type });
};

/**
 * `PUT /v1/{project}/files` — read files, from the repo or from a patch.
 *
 * PUT with a body because the request is a list of files; that is the real
 * protocol, oddity included. Note the two encodings the caller expects: a repo
 * file comes back as plain base64 and a patch file as the base64 data URL it was
 * uploaded as.
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
      if (!file) {
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
        value: file.data,
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

/**
 * `POST /v1/{project}/commit` — publish.
 *
 * Four things happen, and the tests depend on all of them: the source text lands
 * in the overlay, uploaded binaries move from their patch into the repo (or into
 * remote storage), the patches involved are marked applied rather than deleted,
 * and a commit record appears — which is what turns into a row in the Studio's
 * deployment list on the next `/stat`.
 */
const commit: Handler = async (req, res) => {
  const body = await readJsonBody<{
    patchedSourceFiles: Record<string, string | null>;
    patchedBinaryFilesDescriptors: Record<
      string,
      { patchId: string; remote: boolean }
    >;
    appliedPatches: Record<string, string[]>;
    root: string;
    message: string;
    committer: string;
    existingBranch: string;
    newBranch?: string;
  }>(req);
  if (!body) {
    json(res, 400, { message: "Invalid commit body" });
    return;
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
  for (const [filePath, descriptor] of Object.entries(
    body.patchedBinaryFilesDescriptors ?? {},
  )) {
    // A remote descriptor names the ref; the bytes were uploaded under the path
    // inside it. See `pathInRemoteRef`.
    const storedAs = pathInRemoteRef(filePath) ?? filePath;
    const file = state.patchFiles.get(descriptor.patchId)?.get(storedAs);
    if (!file) {
      // Logged as well as returned: `ValOpsHttp.commit` runs its error body
      // through `getErrorMessageFromUnknownJson` after zod has already wrapped
      // it, so the caller only ever sees "Unknown error" and the reason has to
      // be found here.
      const message = `Commit references a file that was never uploaded: ${filePath} (looked for ${storedAs} in patch ${descriptor.patchId}). Uploaded for that patch: ${JSON.stringify([...(state.patchFiles.get(descriptor.patchId)?.keys() ?? [])])}`;
      console.error(`[mock-content-host] ${message}`);
      json(res, 400, { message });
      return;
    }
    const base64 = file.data.slice(file.data.indexOf(",") + 1);
    if (descriptor.remote) {
      state.remoteFiles.set(filePath, base64);
    } else {
      state.repoOverlay.set(path.posix.join(body.root || "/", filePath), {
        encoding: "base64",
        value: base64,
      });
    }
  }
  for (const patchIds of Object.values(body.appliedPatches ?? {})) {
    for (const patchId of patchIds) {
      const patch = state.patches.get(patchId);
      if (patch) {
        patch.applied = { commitSha };
      }
    }
  }
  const record: MockCommit = {
    commitSha,
    clientCommitSha: commitSha,
    parentCommitSha,
    commitMessage: body.message ?? null,
    branch: body.newBranch || body.existingBranch,
    creator: body.committer,
    createdAt: nowIso(),
  };
  state.commits.push(record);
  state.headCommitSha = commitSha;
  broadcast({ type: "commit", commit: record });
  // The patches are still in the chain, now applied. Announced so a second
  // editor's Studio learns they were published rather than still pending.
  broadcastChain();
  json(res, 200, {
    updatedFiles: Object.keys(body.patchedSourceFiles ?? {}),
    commit: commitSha,
    branch: record.branch,
  });
};

/** `POST /v1/{project}/commit-summary` — the AI-written publish message. */
const commitSummary: Handler = (req, res) => {
  json(res, 200, { commitSummary: "Mock summary of the changes" });
};

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
const websocketNonce: Handler = (req, res) => {
  const nonce = randomUUID();
  state.nonces.add(nonce);
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
    });
  }
  json(res, 200, {});
};

/**
 * `GET /v1/{project}/ai/sessions/{id}/messages`
 *
 * Empty: this mock keeps no transcript. Reloading a past conversation is a
 * feature of the service, not of the tool plumbing these tests are for — but the
 * route has to answer, because the Studio calls it whenever a session id is
 * restored from the URL.
 */
const aiSessionMessages: Handler = (req, res) => {
  json(res, 200, { messages: [], nextCursor: null });
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
  const resolved: { filePath: string; metadata: unknown }[] = [];
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
      data: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
      type: image.mimeType.startsWith("image/") ? "image" : "file",
      metadata: {
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
      },
      remote: requested.isRemote === true,
    });
    resolved.push({
      filePath: requested.filePath,
      metadata: {
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
      },
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
  prompt: { id?: string; sessionId?: string; message?: unknown },
): Promise<void> {
  const messageId = randomUUID();
  const sessionId = prompt.sessionId ?? randomUUID();
  const imageKeys = imageKeysOf(prompt.message);
  state.aiPrompts.push({
    sessionId: prompt.sessionId ?? null,
    text: promptTextOf(prompt.message),
    imageKeys,
  });
  const existing = state.aiSessions.get(sessionId);
  if (existing) {
    existing.updatedAt = nowIso();
  } else {
    state.aiSessions.set(sessionId, {
      id: sessionId,
      name: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
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
  send({ type: "ai_streaming", id: messageId, chunk: response });
  send({ type: "ai_response", id: messageId, sessionId, response });
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
const controlPlane: Handler = async (req, res, url) => {
  const action = url.pathname.slice("/__test__/".length);
  if (action === "reset" && req.method === "POST") {
    state = emptyState();
    json(res, 200, { ok: true });
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
          bytes: Buffer.from(
            file.data.slice(file.data.indexOf(",") + 1),
            "base64",
          ).byteLength,
        })),
      ),
      commits: state.commits,
      deployments: state.deployments,
      repoOverlay: [...state.repoOverlay.keys()],
      remoteFiles: [...state.remoteFiles.keys()],
      headCommitSha: state.headCommitSha,
      subscribers: sockets.size,
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
    }>(req);
    const deploymentId = body?.deploymentId ?? randomUUID();
    const commitSha = body?.commitSha ?? state.headCommitSha;
    const deploymentState = body?.deploymentState ?? "pending";
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
    broadcast({ type: "deployment", deployment: record });
    json(res, 200, { deployment: record });
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
  switch (route) {
    case "GET /applicable/patches":
      getApplicablePatches(req, res, url);
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
    case "POST /commit":
      await commit(req, res, url);
      return;
    case "POST /commit-summary":
      commitSummary(req, res, url);
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
        parsed as { id?: string; sessionId?: string; message?: unknown },
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

server.listen(PORT, () => {
  console.log(
    `[mock-content-host] listening on http://localhost:${PORT} for project ${PROJECT}`,
  );
});

// #endregion
