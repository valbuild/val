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

/**
 * One author's curated set of patch ids, as `home`'s `patch_groups` holds it.
 *
 * A group is what a publish ships. It is per author and per branch, it is
 * CLOSED by a publish (`publishedAt`), and a write into a closed one is
 * refused — which is the whole reason the client is not allowed to remember an
 * id across publishes.
 */
type MockPatchGroup = {
  patchGroupId: string;
  authorId: string | null;
  branch: string;
  createdAt: string;
  publishedAt: string | null;
  /** Insertion-ordered, though nothing depends on it: a group is a set. */
  patchIds: Set<string>;
  /**
   * The ids the client sent as `patchIds` — what the user actually ASKED for,
   * as opposed to what arrived in `withPatchIds` behind it.
   *
   * `home` stores this per membership row (`explicit` vs `dependency`) and
   * reads what it is not told about as a dependency, so a client that folds the
   * two halves together files every patch — the clicked one included — as
   * something the closure dragged in. Modelled here so a test can tell the two
   * apart; nothing in the mock's own behaviour depends on it.
   */
  askedForPatchIds: Set<string>;
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
  /**
   * Patch groups, by id. Insertion-ordered, like `patches`.
   *
   * Only consulted when {@link State.patchGroupsEnabled} is on — see there for
   * why that is a switch rather than always.
   */
  patchGroups: Map<string, MockPatchGroup>;
  /**
   * Whether this mock has patch groups at all.
   *
   * OFF by default, and that is the honest default rather than a convenience:
   * it is what a content API that predates groups does, which is what every
   * deployed project is today. With it off, `GET /patch-groups` 404s exactly as
   * an unknown route would, the Val server reads that as "could not ask", and
   * the annotation stays absent — so staging stays off and every other http
   * spec sees the behaviour it was written against.
   */
  patchGroupsEnabled: boolean;
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
};

function emptyState(): State {
  return {
    patches: new Map(),
    patchFiles: new Map(),
    commits: [],
    deployments: [],
    repoOverlay: new Map(),
    remoteFiles: new Map(),
    patchGroups: new Map(),
    patchGroupsEnabled: false,
    nonces: new Set(),
    headCommitSha: process.env.MOCK_CONTENT_INITIAL_COMMIT ?? "mockcommit0",
    aiImages: new Map(),
    aiSessions: new Map(),
    aiScripts: [],
    aiPrompts: [],
    aiToolCalls: [],
    aiOffline: false,
  };
}

let state = emptyState();

/** Every subscribed browser. Written to by the control plane and by commits. */
const sockets = new Set<WebSocket>();
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
    /**
     * Deliberately absent on the write path, so the server resolves the
     * author's open group. See {@link getOrCreateOpenGroup}.
     */
    patchGroupId?: string | null;
    /** What must move with this patch. */
    withPatchIds?: string[];
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
      ...groupOfPatch(body.patchId),
    });
    return;
  }
  const parentPatchId = body.parentPatchId ?? null;
  if (parentPatchId !== null && !state.patches.has(parentPatchId)) {
    // Gone, not merely stale: nothing the client can re-sync to makes this id
    // exist again. JSON with a `message`, because that is what `ValOpsHttp`
    // reads a non-409 body as — a text body would reach the user as the status
    // line instead of as this sentence.
    json(res, 404, { message: "Parent patch not found" });
    return;
  }
  const head = headPatchId();
  if (parentPatchId !== head) {
    res.writeHead(409, { "Content-Type": "text/plain", ...corsHeaders(res) });
    res.end(
      `Parent patch ${parentPatchId ?? "<head>"} is not the head of the chain (${head ?? "<empty>"})`,
    );
    return;
  }
  /*
   * Everything that can REFUSE runs before the patch is stored, matching what
   * `home` does inside its transaction: an invalid closure is a 400 with
   * nothing written, rather than a patch that exists outside its author's
   * group — which is a patch its author cannot publish until a repair puts it
   * back.
   */
  const withPatchIds = body.withPatchIds ?? [];
  if (state.patchGroupsEnabled) {
    const unknown = withPatchIds.filter(
      (patchId) => !state.patches.has(patchId),
    );
    if (unknown.length > 0) {
      json(res, 400, {
        message: `Unknown patch ids in withPatchIds: ${unknown.join(", ")}`,
      });
      return;
    }
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
  let patchGroupId: string | undefined;
  if (state.patchGroupsEnabled) {
    /*
     * The author's own group, and NOBODY else's.
     *
     * An earlier revision of `home` fanned every new patch out to every open
     * group on the branch. Too broad: what a view has to hold is everything
     * that could shift ITS paths, and that is exactly the author's patch sets —
     * which `withPatchIds` already carries, computed on the client, the only
     * side with the schema.
     */
    const group =
      body.patchGroupId != null
        ? state.patchGroups.get(body.patchGroupId)
        : getOrCreateOpenGroup(body.authorId ?? null, body.branch ?? "main");
    if (!group) {
      json(res, 404, { message: "Patch group not found" });
      return;
    }
    // The new patch is what its author meant; the closure is what came with it.
    // `home` files them as 'explicit' and 'dependency' respectively.
    if (!group.patchIds.has(body.patchId)) {
      group.askedForPatchIds.add(body.patchId);
    }
    group.patchIds.add(body.patchId);
    for (const patchId of withPatchIds) {
      group.patchIds.add(patchId);
    }
    patchGroupId = group.patchGroupId;
  }
  broadcastChain();
  json(res, 200, {
    patchId: body.patchId,
    createdAt: nowIso(),
    ...(patchGroupId !== undefined ? { patchGroupId } : {}),
  });
};

/** The group holding this patch, as a spreadable fragment. */
function groupOfPatch(patchId: string): { patchGroupId?: string } {
  if (!state.patchGroupsEnabled) return {};
  for (const group of state.patchGroups.values()) {
    if (group.patchIds.has(patchId)) {
      return { patchGroupId: group.patchGroupId };
    }
  }
  return {};
}

/**
 * This author's open group on this branch, created if they have none.
 *
 * Mirrors `dal.patchGroups.getOrCreateOpen` in `home`. It is the reason a write
 * names no group: the client cannot hold an id across publishes, because a
 * publish closes the group and the next write into it would be refused — so the
 * server resolves "whichever is open, or a new one" on every save.
 */
function getOrCreateOpenGroup(
  authorId: string | null,
  branch: string,
): MockPatchGroup {
  for (const group of state.patchGroups.values()) {
    if (
      group.publishedAt === null &&
      group.branch === branch &&
      group.authorId === authorId
    ) {
      return group;
    }
  }
  const group: MockPatchGroup = {
    patchGroupId: randomUUID(),
    authorId,
    branch,
    createdAt: nowIso(),
    publishedAt: null,
    patchIds: new Set(),
    askedForPatchIds: new Set(),
  };
  state.patchGroups.set(group.patchGroupId, group);
  return group;
}

/**
 * `GET /v1/{project}/patch-groups?branch=` — every group on the branch.
 *
 * `branch` is required and answered 400 without it, as the real endpoint does.
 * That is not pedantry: `ValOpsHttp.getPatchGroups` omitted it once, every
 * lookup failed, and because a failed lookup is not distinguishable from "no
 * groups" at a glance the whole feature was silently off.
 */
const getPatchGroups: Handler = (req, res, url) => {
  if (!state.patchGroupsEnabled) {
    // What a content API that predates groups answers. See
    // `State.patchGroupsEnabled`.
    json(res, 404, { message: "Patch groups are not enabled on this mock" });
    return;
  }
  const branch = url.searchParams.get("branch");
  if (!branch) {
    json(res, 400, { message: "Missing branch" });
    return;
  }
  json(res, 200, {
    patchGroups: [...state.patchGroups.values()]
      .filter((group) => group.branch === branch)
      .map((group) => ({
        patchGroupId: group.patchGroupId,
        authorId: group.authorId,
        createdAt: group.createdAt,
        publishedAt: group.publishedAt,
        patchIds: [...group.patchIds],
      })),
  });
};

/**
 * `POST`/`DELETE /v1/{project}/patch-groups/{id}/patches` — stage and unstage.
 *
 * A union and a difference, and nothing cleverer. The client sends a set it has
 * already closed over its patch sets; deriving that closure needs the content
 * schema, which the content API does not have, so it does not second-guess it.
 */
const mutatePatchGroup: Handler = async (req, res, url) => {
  if (!state.patchGroupsEnabled) {
    json(res, 404, { message: "Patch groups are not enabled on this mock" });
    return;
  }
  const patchGroupId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
  /*
   * The content API's OWN ownership check, in `home`'s order.
   *
   * `resolveOwnOpenGroup` refuses in this sequence: no profile → 403, unknown
   * group → 404, someone else's → 403, already published → 409. The order is
   * observable — a published group belonging to somebody else is 403 there and
   * would be 409 if the published check came first — and the point of this mock
   * is to answer what the thing it stands in for answers.
   *
   * The app's API key names the PROJECT, not the person, so the caller's
   * identity arrives as `x-val-profile-id` — a claim the app makes alongside
   * its key. Without it there is no profile to compare against `group.authorId`
   * and the real content API answers 403 rather than trusting the key.
   *
   * Modelling the refusal matters as much as modelling the success: this mock
   * had no auth on these routes at all, so `ValOpsHttp` not sending the header
   * looked like it worked here while failing every stage in production.
   */
  const profileId = req.headers["x-val-profile-id"];
  if (typeof profileId !== "string" || profileId.length === 0) {
    res.writeHead(403, { "Content-Type": "text/plain", ...corsHeaders(res) });
    res.end(
      "Cannot resolve the caller's profile, so patch group ownership cannot be checked",
    );
    return;
  }
  const group = state.patchGroups.get(patchGroupId);
  if (!group) {
    json(res, 404, { message: "Patch group not found" });
    return;
  }
  if (group.authorId === null || group.authorId !== profileId) {
    res.writeHead(403, { "Content-Type": "text/plain", ...corsHeaders(res) });
    res.end("Patch group belongs to another user");
    return;
  }
  if (group.publishedAt !== null) {
    // 409 rather than 500, because the client distinguishes it: the group has
    // shipped and this id will never be writable again.
    res.writeHead(409, { "Content-Type": "text/plain", ...corsHeaders(res) });
    res.end("Patch group is already published");
    return;
  }
  const body = await readJsonBody<{
    patchIds: string[];
    withPatchIds?: string[];
    coreVersion?: string | null;
  }>(req);
  // `patchIds` is what the user asked for and `withPatchIds` is what came with
  // it. Both join or leave the group; only the first half is `explicit`, which
  // is how `home` files them.
  const explicit = body?.patchIds ?? [];
  const dependency = body?.withPatchIds ?? [];
  for (const patchId of [...explicit, ...dependency]) {
    if (req.method === "POST") {
      if (!state.patches.has(patchId)) {
        json(res, 400, { message: `Unknown patch id: ${patchId}` });
        return;
      }
      /*
       * The reason is recorded on FIRST entry only, because `home`'s upsert is
       * `ON CONFLICT DO NOTHING` — so a patch that arrived as a dependency
       * stays one even when its owner later stages it by hand, and one that
       * arrived explicit is not demoted by a later closure.
       *
       * Modelled rather than glossed over: this mock has twice been kinder than
       * the thing it stands in for (the missing `x-val-profile-id`, and closing
       * groups on a rule of its own), and both times a test was green against a
       * server that does not behave that way.
       */
      if (!group.patchIds.has(patchId) && explicit.includes(patchId)) {
        group.askedForPatchIds.add(patchId);
      }
      group.patchIds.add(patchId);
    } else {
      group.patchIds.delete(patchId);
      group.askedForPatchIds.delete(patchId);
    }
  }
  json(res, 200, {
    patchGroupId: group.patchGroupId,
    patchIds: [...group.patchIds],
  });
};

/** `DELETE /v1/{project}/patches` — what discard and the auto-delete path call. */
const deletePatches: Handler = async (req, res) => {
  const body = await readJsonBody<{
    patchIds: string[];
    unstagePatchIds?: string[];
  }>(req);
  const ids = body?.patchIds ?? [];
  for (const patchId of ids) {
    state.patches.delete(patchId);
    state.patchFiles.delete(patchId);
    // Membership of a deleted patch goes with it — `home` gets this from an
    // ON DELETE CASCADE.
    for (const group of state.patchGroups.values()) {
      group.patchIds.delete(patchId);
      group.askedForPatchIds.delete(patchId);
    }
  }
  /*
   * A cascade alone is not enough.
   *
   * Deleting a patch out of the middle of a patch set leaves every group still
   * holding the rest with a non-prefix intersection, which is the one invariant
   * a group has: the patches after the hole were written against a view that
   * had it. Working out which those are needs the content schema, so the client
   * computes the forward closure and sends it, and those lose their membership
   * everywhere WITHOUT being deleted.
   */
  for (const patchId of body?.unstagePatchIds ?? []) {
    for (const group of state.patchGroups.values()) {
      group.patchIds.delete(patchId);
      group.askedForPatchIds.delete(patchId);
    }
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
    /** The group this commit empties, if the client says it empties one. */
    patchGroupId?: string;
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
  /*
   * A publish CLOSES the group the request NAMES, and no other.
   *
   * This used to close any group all of whose patches the commit shipped, which
   * was a nicer rule and not `home`'s: `postCommit.ts` calls `markPublished`
   * only when the body carries `patchGroupId`. So the mock was closing groups
   * production leaves open, and every test of the post-publish window here was
   * green against a rule the real server does not implement — the same shape as
   * the missing `x-val-profile-id`, which this mock also failed to catch by
   * being more permissive than the thing it stands in for.
   *
   * Unconditional, like `home`: it does not check that the commit shipped the
   * whole group. That is exactly why the client must only name a group it has
   * emptied — and why the mock must not quietly make a mistaken name safe.
   */
  if (state.patchGroupsEnabled && typeof body.patchGroupId === "string") {
    const group = state.patchGroups.get(body.patchGroupId);
    if (group !== undefined && group.publishedAt === null) {
      group.publishedAt = nowIso();
    }
  }
  /*
   * And the applied ids leave EVERY group, named or not.
   *
   * `home` does this on its own (`removePatchesFromAllGroups`), separately from
   * closing: they are in the base now, so leaving them behind would make the
   * next person's publish try to re-apply an applied patch.
   */
  if (state.patchGroupsEnabled) {
    const committed = new Set(Object.values(body.appliedPatches ?? {}).flat());
    for (const group of state.patchGroups.values()) {
      for (const patchId of committed) {
        group.patchIds.delete(patchId);
        group.askedForPatchIds.delete(patchId);
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
  if (action === "patch-groups" && req.method === "POST") {
    /*
     * Turn patch groups on for this run.
     *
     * A switch rather than a fixture, because "this deployment has no groups"
     * is a state the product must keep working in — it is what every project
     * is today — and a mock that always had them would stop testing it.
     */
    const body = await readJsonBody<{ enabled?: boolean }>(req);
    state.patchGroupsEnabled = body?.enabled !== false;
    json(res, 200, { ok: true, enabled: state.patchGroupsEnabled });
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
       * What each group holds, so a test can assert on the SERVER's answer
       * rather than on what the screen is showing.
       *
       * The distinction is the point: a stage that moves the local scope and
       * never reaches the server looks identical in the browser and is lost on
       * reload — which is the dangerous direction for an unstage, because the
       * change silently comes back staged and the next publish ships what the
       * user meant to hold.
       */
      patchGroups: [...state.patchGroups.values()].map((group) => ({
        patchGroupId: group.patchGroupId,
        authorId: group.authorId,
        publishedAt: group.publishedAt,
        patchIds: [...group.patchIds],
        // Exposed only here, on the test-facing state dump — the content API's
        // own `GET /patch-groups` does not report it either.
        askedForPatchIds: [...group.askedForPatchIds],
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
      socketsAccepted,
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
    if (body?.broadcast !== false) {
      broadcast({ type: "deployment", deployment: record });
    }
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
  if (
    /^\/patch-groups\/[^/]+\/patches$/.test(rest) &&
    (req.method === "POST" || req.method === "DELETE")
  ) {
    await mutatePatchGroup(req, res, url);
    return;
  }
  switch (route) {
    case "GET /patch-groups":
      getPatchGroups(req, res, url);
      return;
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
