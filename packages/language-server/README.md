# `@valbuild/language-server`

The Val language server: validation, quick fixes and completions for `*.val.ts`
files, over the Language Server Protocol.

It ships **inside Val**, as a dependency of `@valbuild/next` and
`@valbuild/cli`. You do not install it — a project on a recent enough Val
already has it. That is the point: an editor client resolves the server out of
the user's own `node_modules`, so one published client works against every
version of Val, and a feature Val gains works without an editor release.

The VS Code extension ([`valbuild/vscode-val-build`](https://github.com/valbuild/vscode-val-build))
is a client of this package and nothing more. Any LSP client can be one; this
document is what you need to write another.

## Running it

```bash
# Through the CLI, which imports this package.
npx val lsp --stdio

# Or the binary directly, once you have resolved it (see below). Note that
# `node_modules/.bin/val-language-server` exists only when the project depends on
# this package directly -- pnpm does not link a transitive dependency's bins.
node <resolved>/bin.js --stdio
```

The transport is chosen from argv — `--stdio`, `--node-ipc`, or
`--socket=<port>` — so the same binary serves an editor that prefers IPC and one
that prefers stdio.

### Finding the binary

A client must resolve it from the **user's project**, not bundle its own. There
is one trap, and it is the whole reason this section exists: the package is a
_transitive_ dependency, and under pnpm's isolated `node_modules` a transitive
dependency **is not resolvable from the project root**. A plain
`require.resolve("@valbuild/language-server", { paths: [projectRoot] })` passes
under npm and fails under pnpm.

So resolve _through_ a package the project depends on directly:

```js
import { createRequire } from "node:module";

const rootPkg = path.join(projectRoot, "package.json");
// A direct dependency wins; otherwise go through whichever package carries it.
// @valbuild/core and @valbuild/server are NOT valid anchors -- they do not
// depend on the language server, and could not without a cycle.
for (const anchor of [null, "@valbuild/next", "@valbuild/cli"]) {
  const from =
    anchor === null
      ? rootPkg
      : createRequire(rootPkg).resolve(`${anchor}/package.json`);
  const pkgPath = createRequire(from).resolve(
    "@valbuild/language-server/package.json",
  );
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return path.resolve(path.dirname(pkgPath), pkg.bin["val-language-server"]);
}
```

This works because `./package.json` is in the package's `exports` map; Node's
exports enforcement would otherwise block the subpath.

Yarn PnP has no `node_modules` at all, so path resolution cannot work there.
Offer an explicit override — the VS Code extension has
`valBuild.languageServerPath` and `VAL_LANGUAGE_SERVER_PATH` — and **report when
one is in use**, or it becomes the invisible reason a session misbehaves. The
same override is how you develop against an unreleased Val: point it at a
monorepo checkout's `packages/language-server/bin.js`, which runs directly
because `preconstruct dev` maps the entry to the TypeScript source.

**One server per Val root.** Roots in a monorepo may pin different versions of
Val, so they need different servers. A Val root is the directory of a
`package.json` that has a `val.config.{ts,js}` somewhere beneath it, ignoring
anything under `node_modules`. Confine each client's document selector to its own
root so two servers never both claim a file.

## The handshake

Send this as `InitializeParams.initializationOptions`:

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

All of it is optional in practice: a client that sends nothing gets `valRoot`
from `workspaceFolders[0]`, then `rootPath`, then `process.cwd()`, and the
narrowest protocol range. A hand-written Neovim config therefore works without
any of this — sending it just makes the behaviour explicit.

Announce what you can do under `capabilities.experimental.val`:

```ts
type ValClientCapabilities = { pick?: boolean; input?: boolean };
```

The server replies under `InitializeResult.capabilities.experimental.val`:

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
  features: string[];
  commands: string[];
};
```

Three rules that are easy to get wrong:

1. **Check `incompatible` first**, and never infer compatibility from which
   capabilities are present: `vscode-languageserver` injects `textDocumentSync`
   into the `InitializeResult` on its own, so its presence proves nothing.
2. **`incompatible.status` is directional on purpose.** `client-too-old` means
   tell the user to update the editor client; `server-too-old` means tell them to
   update Val in their project. A generic "incompatible versions" message is a
   dead end.
3. **Read `features`, never a copy of the list below.** An **unknown** string is
   a capability this Val has that you do not know about — ignore it. A
   **missing** string means not available — hide that UI. This is the mechanism
   that lets a newer Val degrade gracefully against an older client.

Additive changes — a new feature flag, a new command, a new optional field — do
not bump `protocolVersion`. Only a removed or renamed request, a changed payload
shape, or changed semantics an older client would misread.

### Features

| Flag                       | What it covers                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnostics`              | Validation and schema errors, fatal module errors, missing file references, modules absent from `val.modules`, and `keyOf`/`route` resolution with did-you-mean suggestions. |
| `fix/metadata`             | Quick fixes for image and file metadata, computed by the same pipeline as `val validate --fix`.                                                                              |
| `fix/gallery`              | Quick fix correcting a gallery's stored metadata against the files on disk.                                                                                                  |
| `fix/missing-module`       | Quick fix registering a `*.val.ts` in `val.modules`.                                                                                                                         |
| `fix/upload-remote`        | Upload a local file to Val Remote. A command, not an edit — it needs credentials.                                                                                            |
| `fix/download-remote`      | Download a remote file back into the project.                                                                                                                                |
| `login`                    | The `val.login` command (device flow; writes `.val/pat.json`, the same file the CLI uses).                                                                                   |
| `completions/mediaPath`    | The `path` of an image or file, with `width`/`height`/`mimeType` filled in on accept.                                                                                        |
| `completions/galleryKey`   | Keys of an `s.images()` / `s.files()` collection.                                                                                                                            |
| `completions/keyOf`        | Keys of the record or object an `s.keyOf()` field points at.                                                                                                                 |
| `completions/route`        | Routes the project defines.                                                                                                                                                  |
| `completions/richtextLink` | Route completion inside a richtext inline link's `href`.                                                                                                                     |

Diagnostics are **push-based** (`textDocument/publishDiagnostics`), debounced
200ms after an edit. Every one carries structured `Diagnostic.data`:

```ts
type ValDiagnosticData = {
  code:
    | "val/validation"
    | "val/schema"
    | "val/fatal"
    | "val/file-not-found"
    | "val/missing-module";
  sourcePath: string;
  fixes?: string[]; // ValidationFix names from @valbuild/core
  value?: unknown;
  filePath?: string;
  fixSourcePath?: string;
};
```

The client round-trips `data` back on `textDocument/codeAction`, which is where
the fixes come from. Do not parse the `code` string for anything.

### Quick fixes and commands

Most quick fixes are ordinary `CodeAction`s carrying a `WorkspaceEdit`. Three
things cannot be: logging in, uploading bytes, and downloading them. Those are
`workspace/executeCommand` names, advertised in `commands`, and the remote fixes
appear as code actions carrying a `command` rather than an `edit`.

**A client needs no Val-specific code for any of this.** Forward a code action's
`command` back to the server — `vscode-languageclient` and Neovim's
`vim.lsp.buf.code_action` both do it automatically — and the server does the
work, reporting progress with `$/progress`, opening the browser with
`window/showDocument`, and applying the result with `workspace/applyEdit`.

`val.login` is the one command worth exposing directly, since a user invokes it
rather than reaching it through a diagnostic.

### The two custom requests

Standard LSP covers applying edits, opening a URL, progress and confirmations.
Only two UI primitives are missing, and both are deliberately content-agnostic —
they carry no Val types, so they never change when Val changes:

```ts
"val/pick"  : { title, placeholder?, items: { label, description?, detail?, value }[] }
              -> { value: string } | null      // null = dismissed

"val/input" : { title, prompt?, value?, placeholder?, password? }
              -> { value: string } | null      // null = dismissed
```

Implement them and say so in `ValClientCapabilities`; the server only offers
flows needing them when you do.

### Watched files

The server handles `workspace/didChangeWatchedFiles`, and **registers the
watchers itself** when the client supports dynamic registration. So a client that
does nothing still notices a `.val.ts` changed by `git checkout`, a
`val validate --fix` run in a terminal, or an image dropped into `/public`. If
your client cannot do dynamic registration, watch `**/*.val.{ts,js}`,
`**/val.modules.{ts,js}`, `**/val.config.{ts,js}` and `**/public/**` yourself.

## Neovim

With `nvim-lspconfig`, resolving the server from the project as described above:

```lua
local util = require("lspconfig.util")

-- Resolve the server entry the way the section above describes, by asking node.
-- Deliberately NOT `node_modules/.bin/val-language-server`: pnpm only links the
-- bins of a project's DIRECT dependencies, and this package is a transitive one,
-- so that path does not exist in exactly the layout most likely to be used.
local RESOLVE = [[
const { createRequire } = require("node:module");
const fs = require("fs"), path = require("path");
const rootPkg = path.join(process.argv[2], "package.json");
for (const anchor of [null, "@valbuild/next", "@valbuild/cli"]) {
  try {
    const from = anchor === null
      ? rootPkg
      : createRequire(rootPkg).resolve(anchor + "/package.json");
    const pkgPath = createRequire(from).resolve(
      "@valbuild/language-server/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const bin = pkg.bin && pkg.bin["val-language-server"];
    if (bin) {
      process.stdout.write(path.resolve(path.dirname(pkgPath), bin));
      break;
    }
  } catch (e) {}
}
]]

local function val_server_cmd(root)
  local override = vim.env.VAL_LANGUAGE_SERVER_PATH
  if override and override ~= "" then
    return { "node", override, "--stdio" }
  end
  local entry = vim.fn.system({ "node", "-e", RESOLVE, root })
  entry = vim.trim(entry)
  if vim.v.shell_error == 0 and entry ~= "" then
    return { "node", entry, "--stdio" }
  end
  -- Nothing resolved: this project's Val is older than the language server, or
  -- its dependencies are not installed. Say so rather than starting nothing.
  vim.notify(
    "Val: no @valbuild/language-server in " .. root ..
      " -- upgrade @valbuild/next or @valbuild/cli.",
    vim.log.levels.WARN
  )
  return nil
end

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "typescript", "javascript" },
  callback = function(args)
    local root = util.root_pattern("val.config.ts", "val.config.js")(
      vim.api.nvim_buf_get_name(args.buf)
    )
    if not root then
      return
    end
    local cmd = val_server_cmd(root)
    if not cmd then
      return
    end
    vim.lsp.start({
      name = "valbuild",
      cmd = cmd,
      root_dir = root,
      init_options = {
        client = { name = "neovim", version = tostring(vim.version()) },
        supportedProtocolVersions = { min = 1, max = 1 },
        valRoot = root,
      },
      capabilities = vim.tbl_deep_extend(
        "force",
        vim.lsp.protocol.make_client_capabilities(),
        -- Only needed for flows that ask the user something; diagnostics,
        -- completions and quick fixes work without it.
        { experimental = { val = { pick = true, input = true } } }
      ),
      handlers = {
        ["val/pick"] = function(_, params)
          local labels = {}
          for _, item in ipairs(params.items) do
            table.insert(labels, item.label)
          end
          local choice = vim.fn.inputlist(labels)
          if choice < 1 or choice > #params.items then
            return vim.NIL
          end
          return { value = params.items[choice].value }
        end,
        ["val/input"] = function(_, params)
          local value = vim.fn.input(params.prompt or params.title or "", params.value or "")
          if value == "" then
            return vim.NIL
          end
          return { value = value }
        end,
      },
    })
  end,
})
```

Diagnostics, `vim.lsp.buf.code_action()` and omnicompletion then work as usual.
`:lua vim.lsp.buf.execute_command({ command = "val.login", arguments = {} })`
logs in.

Read the server's `features` from
`vim.lsp.get_clients()[1].server_capabilities.experimental.val.features` if you
want to gate anything on what this Val version actually serves.

## Testing a client against it

**Do not run the server in-process under a test runner.**
`vscode-languageserver/node` registers `end` and `close` handlers on its input
stream that call `process.exit()`, so ending a stream in teardown kills the test
worker and the run hangs rather than failing. Under `--stdio` it also replaces
the global `console`. Spawn it as a child process over stdio instead — which also
tests the real launch path:

```ts
const child = spawn(process.execPath, [entry, "--stdio"], { cwd: valRoot });
const client = createMessageConnection(
  new StreamMessageReader(child.stdout),
  new StreamMessageWriter(child.stdin),
);
client.onUnhandledNotification(() => {}); // it logs via window/logMessage
client.listen();
// teardown: client.dispose(); child.kill();
// Never end/destroy the streams, and never send `exit`.
```

Assert the child writes **nothing** to stderr on a successful start: editors read
stderr noise from a language server as a startup failure, and it is the cheapest
possible regression test for the launch path.

`src/__testHelpers__/lspClient.ts` in this package is a working harness, and
`src/server.test.ts`, `diagnostics.test.ts`, `codeActions.test.ts` and
`completions.test.ts` drive it against `examples/next`.
