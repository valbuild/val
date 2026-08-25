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
 *
 * The browser, cross-origin, with `x-val-auth-nonce`:
 *   POST   /v1/{project}/patches/{patchId}/files      (the bytes of an upload)
 *   WS     /ws                                        (patches, commits, deployments)
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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
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
    data: string;
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
const wss = new WebSocketServer({ server, path: "/ws" });
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

server.listen(PORT, () => {
  console.log(
    `[mock-content-host] listening on http://localhost:${PORT} for project ${PROJECT}`,
  );
});

// #endregion
