# Prompt: prepare `vscode-val-build` for `@valbuild/language-server`

> **How to use this document.** Open a Claude Code session in the
> `vscode-val-build` repo and paste everything below the line. It is written to be
> self-contained — that session will not have any context from the Val monorepo
> work that produced it.
>
> Assumes `@valbuild/language-server` **is published on npm as `0.98.0`**, along
> with the matching `@valbuild/next` / `@valbuild/cli` / `@valbuild/server`. If the
> release train landed a different number, substitute it throughout — nothing here
> depends on the exact digits, only on "the version that first contains the
> language server". Facts about this extension were verified on 2026-08-03.
>
> The Val monorepo may also be checked out alongside at `../val-main`, which is
> useful for developing against unreleased Val, but nothing in this document
> requires it.

---

## Goal

Prepare this extension so that **one published extension version works against
many versions of Val**. Today it cannot, and the reason is not light coupling —
this extension is a partial reimplementation of Val, pinned to one version:

- `server/src/valModules.ts` + `tsRuntime.ts` (~700 lines) is a `node:vm` re-do of
  Val's `createService`. It generates source strings that call
  `Internal.getSchema(m)['executeSerialize']()` — a `protected` method reached by
  bracket-access to dodge TypeScript. If Val renames it, every module silently
  gets `schema === undefined`.
- Two different `@valbuild/core` copies interpret the same data: the user's core
  produces `schema`/`source`/`validation`, then this extension's **own pinned
  core** re-interprets it via `Internal.resolvePath` and
  `splitModuleFilePathAndModulePath`.
- `server/src/completionFieldSchema.ts` hand-rolls schema traversal; unknown
  schema kinds silently return no completions.
- `client/src/mimeType/all.ts` and `server/src/mimeType/all.ts` are two byte-identical
  696-line copies of Val's `packages/core/src/mimeType/all.ts`.
- `server/src/routeValidation.ts`, `client/src/evalValConfigFile.ts`,
  `{client,server}/src/metadataUtils.ts` are likewise copies of code that already
  exists in `@valbuild/*`.
- Undocumented schema fields are read by `in`-check (`referencedModule`,
  `mediaType`, `directory`, `router`, `include`/`exclude`, `keyOf` target under one
  of three possible keys). A rename produces **silent feature loss** — no
  diagnostic, no log.
- A validation hash is smuggled through the LSP `Diagnostic.code` string
  (`` `${fix}:${hash}` ``) and re-split with `diag.code.split(":")[2]`.
- There is **no version check anywhere**. `Internal.VERSION.core` falls back to the
  literal `"unknown"`, which then feeds the remote-file hash, silently producing a
  ref Val will reject.

The end state: all version-sensitive logic lives in `@valbuild/language-server`,
which ships with the user's Val. This extension becomes a launcher of roughly 350
lines. Because the contract is LSP, Neovim/Zed/JetBrains get support nearly free.

**This document covers preparation only — not the flip.** See "Explicitly out of
scope" at the end.

---

## The published package

|                         |                                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| Package                 | `@valbuild/language-server@0.98.0`                                     |
| Binary                  | `val-language-server` (also `npx val lsp --stdio` via `@valbuild/cli`) |
| `PROTOCOL_VERSION`      | `1`                                                                    |
| Exports                 | `.` and `./package.json`                                               |
| Present in projects via | `dependencies` of `@valbuild/next` **and** `@valbuild/cli`             |
| Minimum Val version     | `@valbuild/next >= 0.98.0` or `@valbuild/cli >= 0.98.0`                |

Because it is a dependency of `@valbuild/next`, any project on Val `>= 0.98.0`
already has it — users do not install anything. A project on an older Val does not
have it at all, which is a Val upgrade, not a missing dependency. That distinction
drives the failure messaging in Task 5.

`0.98.0` completes an `initialize` handshake and serves **no language features**
(`features: []`). Diagnostics, completions and commands arrive in later Val
releases. That is deliberate, and it is what makes this preparation work safe:
nothing you build here changes behaviour until Val starts advertising features, so
you can ship it long before Val is ready.

### The handshake

Sent by the client as `InitializeParams.initializationOptions`:

```ts
type ValInitializationOptions = {
  client: { name: string; version: string | null };
  supportedProtocolVersions: { min: number; max: number };
  /** Absolute path to the directory containing this project's package.json. */
  valRoot: string;
  env?: {
    VAL_CONTENT_URL?: string;
    VAL_REMOTE_HOST?: string;
    VAL_BUILD_URL?: string;
  };
};
```

Announced by the client under `capabilities.experimental.val`:

```ts
type ValClientCapabilities = { pick?: boolean; input?: boolean };
```

Returned by the server in `InitializeResult.capabilities.experimental.val`:

```ts
type ValServerCapabilities = {
  protocolVersion: number;
  /** Set ONLY when negotiation failed. Check this FIRST. */
  incompatible?: {
    status: "client-too-old" | "server-too-old";
    server: { min: number; max: number };
    client: { min: number; max: number };
  };
  versions: { core: string | null; languageServer: string | null };
  valRoot: string;
  features: string[]; // e.g. "diagnostics", "completions/route", "fix/upload-remote"
  commands: string[]; // workspace/executeCommand names
};
```

Rules that matter:

- **Check `incompatible` first.** Do not infer compatibility from absent
  capabilities: `vscode-languageserver` injects `textDocumentSync` into the
  `InitializeResult` on its own, so its presence proves nothing.
- `incompatible.status` is **directional** on purpose. `client-too-old` → tell the
  user to update the extension. `server-too-old` → tell them to update Val in
  their project. Never show a generic "incompatible versions" message.
- Treat an **unknown** string in `features` as "a capability this Val version has
  that I don't know about" and ignore it. Treat a **missing** one as "not
  available" and hide the corresponding UI. This is the mechanism that makes a
  newer Val degrade gracefully against an older extension.

### Custom requests (server → client)

Standard LSP already covers applying edits (`workspace/applyEdit`), opening a URL
in a browser (`window/showDocument` with `external: true`), progress
(`$/progress`) and confirmations (`window/showMessageRequest`). Only two UI
primitives are missing, and both are deliberately content-agnostic — they carry no
Val types, so they never change when Val changes:

```ts
"val/pick"  : { title, placeholder?, items: { label, description?, detail?, value }[] }
              -> { value: string } | null      // null = user dismissed

"val/input" : { title, prompt?, value?, placeholder?, password? }
              -> { value: string } | null      // null = user dismissed
```

---

## Task 1 — The protocol contract

Now that the package is published, split this deliberately: **types from npm,
runtime values vendored.**

```jsonc
// client/package.json
"devDependencies": {
  "@valbuild/language-server": "^0.98.0"  // devDependency, NEVER a dependency
}
```

**Types — import them.** A `devDependency` plus type-only imports gives you
compile-time drift detection for free, and is erased at build time so it creates no
runtime coupling:

```ts
import type {
  ValInitializationOptions,
  ValServerCapabilities,
  ValClientCapabilities,
  ValPickParams,
  ValPickResult,
  ValInputParams,
  ValInputResult,
} from "@valbuild/language-server";
```

It must be `import type`, not a bare `import`. The client is bundled by esbuild
(`--bundle --format=cjs`), and a value import would pull the entire server —
`vscode-languageserver` and all — into `client/out/extension.js`. Add an eslint rule
(`@typescript-eslint/consistent-type-imports`) so this cannot regress silently.

**Runtime values — vendor them.** Put these in `client/src/valProtocol.ts`, copied
from the published package's source:

- `PROTOCOL_VERSION` / the client's own range, set to `{ min: 1, max: 1 }`
- `negotiateProtocolVersion` (plus its tests)
- `VAL_PICK_REQUEST` = `"val/pick"`, `VAL_INPUT_REQUEST` = `"val/input"`

They are vendored rather than imported because they must work **before and
independently of** whatever server version gets resolved — including when no server
resolves at all. Negotiating against a version you imported from npm would defeat
the purpose. This is normal for a wire protocol: both sides hold a copy.

The invariant the tests must pin down: a client at `{min:1,max:1}` keeps working
against every future server, until Val deliberately raises its own `min`.

---

## Task 2 — Resolution

This is the load-bearing detail and the most likely thing to get wrong.

`@valbuild/language-server` is a **transitive** dependency (via `@valbuild/next`
or `@valbuild/cli`). Under pnpm's isolated `node_modules`, a transitive dependency
is **not resolvable from the project root**. So resolution must go _through_ a
package the user depends on directly:

```ts
// client/src/resolveLanguageServer.ts
import { createRequire } from "node:module";
import fs from "fs";
import path from "path";

export type ResolvedLanguageServer = {
  /** Absolute path to the server entry, for LanguageClient's `module`. */
  entry: string;
  version: string;
  /** Which anchor package it was found through, for diagnostics. */
  via: string;
};

export function resolveLanguageServer(
  valRoot: string,
): ResolvedLanguageServer | null {
  // Order matters: a direct dependency wins, then the packages that carry it.
  // @valbuild/core and @valbuild/server are NOT valid anchors -- they do not
  // depend on the language server (that would be a dependency cycle).
  const anchors: (string | null)[] = [null, "@valbuild/next", "@valbuild/cli"];
  const rootPkg = path.join(valRoot, "package.json");

  for (const anchor of anchors) {
    try {
      const from =
        anchor === null
          ? rootPkg
          : createRequire(rootPkg).resolve(`${anchor}/package.json`);
      const pkgPath = createRequire(from).resolve(
        "@valbuild/language-server/package.json",
      );
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const binRel = pkg.bin?.["val-language-server"];
      if (!binRel) continue;
      return {
        entry: path.resolve(path.dirname(pkgPath), binRel),
        version: pkg.version,
        via: anchor ?? "direct dependency",
      };
    } catch {
      // Try the next anchor.
    }
  }
  return null;
}
```

This works because `@valbuild/language-server/package.json` is in the package's
`exports` map (Node's exports enforcement would otherwise block the subpath).

**Test it against all three layouts.** Since the packages are on npm, fixtures are
real installs with no linking needed. Under `client/src/test/fixtures/`, create three
projects each with only `{"dependencies": {"@valbuild/next": "^0.98.0"}}` and install
with npm (hoisted), pnpm (isolated) and yarn respectively. Commit the lockfiles and
install in CI so the fixtures are reproducible.

The pnpm case is the one that earns its keep: a naive
`require.resolve("@valbuild/language-server", { paths: [valRoot] })` passes under npm
and **fails** under pnpm, because the project root only has its direct dependencies.
Add a fixture on an older Val (`@valbuild/next@0.97.x`) too, and assert resolution
returns `null` there — that is the "needs a Val upgrade" path in Task 5.

**Escape hatch.** Yarn PnP has no `node_modules` at all, so path resolution cannot
work there. Add:

- setting `valBuild.languageServerPath` (absolute path to a server entry)
- env var `VAL_LANGUAGE_SERVER_PATH`

Both take precedence over resolution, and both should be reported by
`val.showLanguageServerInfo` when active so an override is never invisible.

These are also how you test against an unreleased Val: point at a local monorepo
checkout's `packages/language-server/bin.js`, which runs directly because
`preconstruct dev` makes the TypeScript source importable.

---

## Task 3 — Launch

Use `LanguageClient` with `module` + `TransportKind.ipc`, not a manual spawn.
That is a one-line change from what `client/src/extension.ts:98-110` already does,
and it keeps IPC transport (faster and more robust than stdio for VS Code):

```ts
const serverOptions: ServerOptions = {
  run: {
    module: resolved.entry,
    transport: TransportKind.ipc,
    options: { cwd: valRoot },
  },
  debug: {
    module: resolved.entry,
    transport: TransportKind.ipc,
    options: { cwd: valRoot },
  },
};
```

**One language server per Val root.** This is a real change: today a single
server handles N Val roots (`server/src/server.ts:110-133` discovers them all).
That no longer works, because different roots in a monorepo may pin different Val
versions and therefore need different servers. Keep a
`Map<valRoot, LanguageClient>`, and scope each client's `documentSelector` with a
`pattern` confined to its root so the two never both claim a file.

Root detection itself can stay as-is: a Val root is the directory of a
`package.json` that has a `val.config.{ts,js}` somewhere beneath it, excluding
anything under `node_modules`.

---

## Task 4 — Client-side UI primitives

Implement `val/pick` (→ `window.showQuickPick`) and `val/input` (→
`window.showInputBox`) as request handlers. Return `null` when the user dismisses.

Also announce them, so the server knows whether it may offer flows that need
interaction:

```ts
clientOptions.initializationOptions = {
  /* ...as above... */
};
// and in the client capabilities:
capabilities.experimental = { val: { pick: true, input: true } };
```

These are inert until Val starts using them — build them now so the flip is
mechanical.

---

## Task 5 — Failure paths

The agreed behaviour is **hard fail with an actionable message** — no bundled
fallback, and no silent version mismatch.

"Not resolvable" is not one situation, and the fixes are different. Before showing
anything, resolve `@valbuild/next/package.json` (falling back to `@valbuild/cli`,
then `@valbuild/core`) from the Val root and read its version. Then:

| Situation                                                  | Behaviour                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No `@valbuild/*` resolves at all                           | Not a Val project (or dependencies not installed). Say nothing — do not nag.                                                                                                                                             |
| Val resolves but is `< 0.98.0`                             | **This is the common case.** "Val's language server requires @valbuild/next 0.98.0 or later — this project has _x.y.z_." Offer `val.upgradeVal` running the detected package manager's upgrade. Not an add-package.      |
| Val is `>= 0.98.0` but the language server is unresolvable | Genuinely unusual — Yarn PnP, a hand-pruned `node_modules`, a broken install. Suggest reinstalling dependencies, then `valBuild.languageServerPath`. Offer a direct add of `@valbuild/language-server` as a last resort. |
| `incompatible.status === "client-too-old"`                 | "Update the Val extension" + marketplace link. Stop the client.                                                                                                                                                          |
| `incompatible.status === "server-too-old"`                 | "Update Val in this project" + both versions. Stop the client.                                                                                                                                                           |
| Resolved and compatible                                    | Status bar shows the Val version being served, and marks it when an override supplied the path.                                                                                                                          |

Detect the package manager from the lockfile: `pnpm-lock.yaml` → pnpm,
`yarn.lock` → yarn, `package-lock.json` → npm, `bun.lockb` → bun. Check pnpm and
yarn first, since some repos carry a stale `package-lock.json`.

Never run an install without the user invoking the command — surface it as an action
on the notification, and show the exact command you will run.

Add a `val.showLanguageServerInfo` command reporting: resolved path, language-server
version, anchor (`via`), whether an override was used, the resolved Val version,
negotiated protocol version, and the `features`/`commands` lists. This is what makes
the mechanism debuggable in the field — build it early, you will use it constantly.

---

## Task 6 — Opt-in switch for dogfooding

Add `valBuild.useProjectLanguageServer` (boolean, **default `false`**).

- `false` (default): current behaviour exactly. The bundled `server/` handles
  everything. Zero risk.
- `true`: resolve and launch the project's server, and suppress each bundled-server
  feature that the resolved server advertises in `features`.

This is what lets you validate each Val phase as it lands without a coordinated
release, and without ever shipping a half-migrated default. Arbitration must be
real — if both servers publish diagnostics for the same file the user sees
duplicates — so pass the negotiated `features` list into the bundled server's own
`initializationOptions` and have it skip those features.

---

## Task 7 — Fix verified pre-existing bugs

All confirmed in this repo on 2026-08-03:

1. **`.vscodeignore` would ship a broken server.** The uncommitted working-tree
   change now excludes `node_modules/**`, `client/node_modules/**` _and_
   `server/node_modules/**`. The server is **not bundled** (`tsc -b` emits plain
   CJS that does `require("@valbuild/core")`, `require("typescript")`,
   `require("glob")`, `require("vscode-languageserver/node")`). Packaging that VSIX
   produces an extension whose language server cannot start, killing all
   diagnostics and completions. Either restore the allowlist or bundle the server.
   Do not release until this is resolved. (It becomes moot once `server/` is
   deleted at the flip.)
2. **Malformed file watcher glob** — `client/src/extension.ts:119-121` passes one
   comma-joined string:
   `"**/*.val.{t,j}s,**/val.config.{t,j}s,**/val.modules.{t,j}s"`. This matches a
   literal path ending in `...val.modules.ts` and therefore never matches
   `.val.ts` files, so `onDidChangeWatchedFiles` — the failed-root retry hook —
   effectively never fires. Should be an array of three patterns.
3. **`image-size` is imported but not declared.** `server/src/metadataUtils.ts:2`
   imports it; it is absent from `server/package.json` and resolves only because
   npm hoists `client`'s copy. Add it, or delete the file as part of the migration.
4. **Dead `@valbuild/server` dependency.** `server/package.json` declares
   `@valbuild/server: ^0.96.1`; nothing imports it (verified: only
   `@valbuild/core` and `@valbuild/next` appear in `client/src` and `server/src`).
   It drags in `@valbuild/shared` + `@valbuild/ui` and pins a third `@valbuild/core`
   version. Remove it.
5. **Six of seven commands are unreachable from the palette.**
   `contributes.commands` lists only `val.login`, but the code registers
   `val.uploadRemoteFile`, `val.downloadRemoteFile`, `val.addModuleToValModules`,
   `val.addToMediaGallery`, `val.moveFileToGalleryDirectory`,
   `val.removeGalleryEntry`. Either contribute them or mark them intentionally
   internal.
6. **Dead setting.** `valBuild.maxNumberOfProblems` is contributed but never read
   (`getDocumentSettings` at `server/src/server.ts:353` is never called).
7. **Lockfiles disagree with the installed tree.** `client/package-lock.json` and
   `server/package-lock.json` pin `@valbuild/core 0.95.0`, but
   `node_modules/@valbuild/*` is `0.96.3` — and `^0.95.0` does not even admit
   `0.96.3` under npm's 0.x caret rule. Whichever version the server requires at
   runtime is effectively whatever npm happened to hoist. Reconcile.
8. **Divergent `val.modules` insertion.** The server-side `val:missing-module` fix
   inserts `import("./x.val")` while the client command
   (`client/src/commands/addModuleToValModules.ts:76`) inserts
   `{ def: () => import("./x.val") }` — two formats for one fix. Pick one.

---

## Testing hazard — read this before writing any test

**Do not run a language server in-process under jest.** Two behaviours in
`vscode-languageserver/node` make it hostile:

- It registers `end` and `close` handlers on its input stream that call
  `process.exit()` (`lib/node/main.js:200-207`). Ending or destroying a stream in
  test teardown kills the jest worker, and the run hangs rather than failing
  cleanly.
- Under `--stdio` it replaces the global `console` (`patchConsole`,
  `lib/node/main.js:218-274`), so server output vanishes into the JSON-RPC stream.

This cost ~300s of hung test runs to diagnose in the Val repo. Test the server as
a **child process** over stdio instead — which also tests the real launch path:

```ts
const child = spawn(process.execPath, [entry, "--stdio"], {
  cwd: valRoot,
  stdio: ["pipe", "pipe", "pipe"],
});
const client = createMessageConnection(
  new StreamMessageReader(child.stdout),
  new StreamMessageWriter(child.stdin),
);
client.onUnhandledNotification(() => {}); // the server logs via window/logMessage
client.listen();

const result = await client.sendRequest("initialize", {
  processId: process.pid,
  rootUri: null,
  capabilities: {},
  initializationOptions: {
    /* ValInitializationOptions */
  },
});

// teardown: client.dispose(); child.kill();  -- never end/destroy the streams,
// and never send `exit` (its default handler calls process.exit).
```

Add a devDependency on `vscode-jsonrpc` for the client side rather than relying on
it being hoisted as a transitive of `vscode-languageclient`.

Also assert the child writes **nothing** to stderr on a successful start: editors
treat stderr noise from a language server as a startup failure, and it is the
cheapest possible regression test for the launch path.

Do not reach for `--forceExit` to paper over a hang; CI runs plain `jest`.

The published package's own tests are a working reference if you have the monorepo
checked out: `packages/language-server/src/server.test.ts` and `binLaunch.test.ts`.

Also relevant: this repo's e2e is entirely dead — `scripts/e2e.sh` and
`client/src/test/*` are fully commented out. Re-enable it for the launcher path,
which is small and stable enough to test properly.

---

## Verification

```bash
npm install          # root postinstall installs client/ and server/
npm run compile      # tsc -b
npm run typecheck
npm test
npx vsce package     # MUST produce a VSIX whose server can actually start
```

Also confirm the type-only import did not leak into the bundle — this is the one
mistake that silently doubles the VSIX and pins the contract:

```bash
grep -c "vscode-languageserver/node" client/out/extension.js   # expect 0
```

Manual checks that matter:

1. With `valBuild.useProjectLanguageServer: false` (default), open a real Val
   project — every current feature must behave exactly as before.
2. Set it to `true` in a project on `@valbuild/next@^0.98.0` —
   `val.showLanguageServerInfo` reports the resolved path, version and anchor.
3. Repeat in a **pnpm** project depending only on `@valbuild/next`. This is the case
   that catches a wrong resolution algorithm; it must resolve `via @valbuild/next`.
4. In a project on `@valbuild/next@0.97.x`, confirm you get the "requires 0.98.0 or
   later" upgrade message — not a "not found" or generic error.
5. Point `valBuild.languageServerPath` at a local monorepo checkout's
   `packages/language-server/bin.js` and confirm the handshake succeeds and that
   `val.showLanguageServerInfo` reports the override.
6. Fake a mismatch by setting the vendored client range to `{min: 99, max: 99}` and
   confirm you get the directional `server-too-old` message.
7. Open a multi-root workspace with two Val roots on **different** Val versions and
   confirm two clients start, each serving only its own root's files.

---

## Explicitly out of scope

`@valbuild/language-server@0.98.0` being on npm does **not** mean it serves any
language features yet — it advertises `features: []`. So do not do these:

- Deleting `server/`, or removing any duplicated code
  (`mimeType/all.ts`, `routeValidation.ts`, `evalValConfigFile.ts`,
  `metadataUtils.ts`, `completionFieldSchema.ts`, `valModules.ts`, `tsRuntime.ts`).
  They stay until the Val server actually serves those features — otherwise users
  lose diagnostics and completions entirely.
- Moving diagnostics, completions or the seven commands.
- Replacing the `Diagnostic.code` hash hack with `Diagnostic.data` — that is a
  coordinated change with the Val server.
- Making `useProjectLanguageServer` default to `true`.
- Adding `@valbuild/language-server` as a runtime `dependency`, or requiring a
  minimum Val version to activate the extension at all.

The deliverable is: the launcher path exists, is tested across package managers, is
debuggable via `val.showLanguageServerInfo`, and is off by default. When a later Val
release starts advertising `features`, flipping the default is the only change
needed.
