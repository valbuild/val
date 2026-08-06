/**
 * The Val language server protocol.
 *
 * This module is the contract between an editor client (for example the Val
 * VS Code extension) and the language server that ships with the Val version
 * installed in the user's project.
 *
 * The whole point of this package is that ONE editor client works against MANY
 * versions of Val. That means:
 *
 *  - Clients MUST NOT assume they can import this module. They resolve the
 *    server from the user's `node_modules` at runtime, and the constants below
 *    are intentionally small and pure so a client can vendor a copy of them.
 *    A client may take a type-only devDependency on this package for the types.
 *  - Anything added here must degrade gracefully. New capabilities are
 *    announced through `features` / `commands` so that a client which has never
 *    heard of them simply does not offer them, instead of breaking.
 *
 * Deliberately dependency-free: no `vscode-languageserver` import, no Val
 * imports, no I/O.
 */

/**
 * The current protocol version.
 *
 * Bump this ONLY for a breaking change to the client/server contract — a
 * removed or renamed request, a changed payload shape, or changed semantics
 * that an older client would misinterpret. Additive changes (a new feature
 * flag, a new command, a new optional field) do NOT need a bump: they are
 * negotiated through `features` and `commands`.
 *
 * This is a hand-maintained literal on purpose. Deriving it from package.json
 * (as `Internal.VERSION.core` does) breaks under bundling, and build-time
 * string substitution (as `@valbuild/ui`'s VERSION does) is easy to get wrong.
 */
export const PROTOCOL_VERSION = 1;

/**
 * The range of protocol versions this server can speak. Kept separate from
 * {@link PROTOCOL_VERSION} so that a future server can continue to serve older
 * clients by lowering `min`.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: ProtocolVersionRange = {
  min: 1,
  max: PROTOCOL_VERSION,
};

export type ProtocolVersionRange = {
  min: number;
  max: number;
};

export type ValClientInfo = {
  /** For example `"vscode-val-build"`. Used for logging and telemetry only. */
  name: string;
  version: string | null;
};

/**
 * Environment overrides forwarded from the client. These mirror the
 * `VAL_*` environment variables so that an editor can point a session at a
 * non-production Val backend without the user having to restart their editor
 * with a modified environment.
 */
export type ValEnvOverrides = {
  VAL_CONTENT_URL?: string;
  VAL_REMOTE_HOST?: string;
  VAL_BUILD_URL?: string;
};

/**
 * Sent by the client as `InitializeParams.initializationOptions`.
 *
 * One server instance serves exactly one Val root. A workspace containing
 * several Val roots (a monorepo) gets one server per root, because different
 * roots may pin different versions of Val.
 */
export type ValInitializationOptions = {
  client: ValClientInfo;
  /** Protocol versions the client can speak. */
  supportedProtocolVersions: ProtocolVersionRange;
  /** Absolute path to the directory containing this project's `package.json`. */
  valRoot: string;
  env?: ValEnvOverrides;
};

/**
 * Optional capabilities a client may implement, announced by the client under
 * `capabilities.experimental.val`.
 *
 * The server uses this to decide whether it can offer flows that need user
 * interaction. A client that implements neither still gets diagnostics and
 * completions.
 */
export type ValClientCapabilities = {
  /** Client implements the {@link VAL_PICK_REQUEST} request. */
  pick?: boolean;
  /** Client implements the {@link VAL_INPUT_REQUEST} request. */
  input?: boolean;
};

/**
 * Feature flags announced by the server under
 * `capabilities.experimental.val.features`.
 *
 * A client should treat an unknown string as "something this Val version can do
 * that I do not know about" and ignore it, and a missing string as "not
 * available in this Val version" and hide the corresponding UI.
 */
export const VAL_FEATURES = [
  "diagnostics",
  "diagnostics/gallery",
  "completions/route",
  "completions/keyOf",
  "completions/mediaPath",
  "completions/galleryKey",
  "completions/richtextLink",
  "fix/metadata",
  "fix/upload-remote",
  "fix/download-remote",
  "fix/missing-module",
  "fix/gallery",
  "login",
] as const;

export type ValFeature = (typeof VAL_FEATURES)[number];

/**
 * Announced by the server as
 * `InitializeResult.capabilities.experimental.val`.
 */
export type ValServerCapabilities = {
  /**
   * The negotiated protocol version — within the client's range unless
   * {@link ValServerCapabilities.incompatible} is set, in which case this is
   * the highest version the server itself can speak.
   */
  protocolVersion: number;
  /**
   * Present only when version negotiation failed. `features` and `commands`
   * are then empty; the client should stop the server and tell the user which
   * side to update. Checking this first is what turns an "incompatible
   * versions" dead end into an actionable message.
   */
  incompatible?: Exclude<ProtocolNegotiationResult, { status: "ok" }>;
  versions: {
    /** Version of `@valbuild/core` resolved in the user's project. */
    core: string | null;
    /** Version of this package. */
    languageServer: string | null;
  };
  /** Echoed back so the client can label the session (status bar, logs). */
  valRoot: string;
  /**
   * Features this server actually serves. Narrower than {@link VAL_FEATURES}
   * when a capability could not be initialised for this project.
   */
  features: ValFeature[];
  /** `workspace/executeCommand` names this server offers. */
  commands: string[];
};

// ---------------------------------------------------------------------------
// Custom requests: server -> client
//
// Standard LSP already covers applying edits (`workspace/applyEdit`), opening a
// URL in a browser (`window/showDocument` with `external: true`), progress
// (`$/progress`) and confirmations (`window/showMessageRequest`). The two
// requests below are the only UI primitives LSP lacks that Val needs.
//
// Both are deliberately content-agnostic: they carry no Val types, so they do
// not change when Val changes.
// ---------------------------------------------------------------------------

/** Ask the user to choose one of a list of options (a "quick pick"). */
export const VAL_PICK_REQUEST = "val/pick";

export type ValPickItem = {
  label: string;
  /** Rendered next to the label. */
  description?: string;
  /** Rendered below the label. */
  detail?: string;
  /** Opaque to the client; returned verbatim in {@link ValPickResult}. */
  value: string;
};

export type ValPickParams = {
  title: string;
  placeholder?: string;
  items: ValPickItem[];
};

/** `null` when the user dismissed the picker. */
export type ValPickResult = { value: string } | null;

/** Ask the user to type a value (an "input box"). */
export const VAL_INPUT_REQUEST = "val/input";

export type ValInputParams = {
  title: string;
  prompt?: string;
  /** Pre-filled value. */
  value?: string;
  placeholder?: string;
  password?: boolean;
};

/** `null` when the user dismissed the input box. */
export type ValInputResult = { value: string } | null;

// ---------------------------------------------------------------------------
// Version negotiation
// ---------------------------------------------------------------------------

export type ProtocolNegotiationResult =
  | {
      status: "ok";
      /** Highest version both sides can speak. */
      protocolVersion: number;
    }
  | {
      /**
       * The server is newer than anything the client understands: the user
       * should update their editor client.
       */
      status: "client-too-old";
      server: ProtocolVersionRange;
      client: ProtocolVersionRange;
    }
  | {
      /**
       * The server is older than anything the client understands: the user
       * should update Val in their project.
       */
      status: "server-too-old";
      server: ProtocolVersionRange;
      client: ProtocolVersionRange;
    };

/**
 * Pick the highest protocol version both sides can speak.
 *
 * Returns a *directional* failure so the client can tell the user which side to
 * update, rather than showing a generic "incompatible versions" error.
 */
export function negotiateProtocolVersion(
  client: ProtocolVersionRange,
  server: ProtocolVersionRange = SUPPORTED_PROTOCOL_VERSIONS,
): ProtocolNegotiationResult {
  const min = Math.max(client.min, server.min);
  const max = Math.min(client.max, server.max);
  if (min <= max) {
    return { status: "ok", protocolVersion: max };
  }
  if (server.max < client.min) {
    return { status: "server-too-old", server, client };
  }
  return { status: "client-too-old", server, client };
}
